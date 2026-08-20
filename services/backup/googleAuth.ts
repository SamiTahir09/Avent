import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * Google OAuth for Drive backup — nothing else.
 *
 * Deliberately separate from Firebase Auth. Firebase signs the user into Avent;
 * this signs the user into *their own* Google Drive. They are different consents
 * (a user can be signed into Avent with an email address that isn't a Google
 * account at all), different lifetimes, and revoking one must not break the
 * other. Keeping them apart is also what lets Drive backup stay a premium
 * feature that free accounts simply never trigger.
 *
 * Only `drive.appdata` is requested. That scope cannot read, list or touch any
 * file the user already has in Drive — it grants access to a hidden per-app
 * folder and nothing more. It is also the one Drive scope that doesn't drag the
 * app into Google's restricted-scope security review.
 */

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// `openid`/`email` are here only so the app can show *which* Google account the
// backup lives in — "Connected to Google" with no address is the kind of vague
// state that makes people distrust a backup. They are not used to sign anyone in;
// Firebase Auth owns that. `drive.appdata` is the only data scope.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const SCOPES = [DRIVE_SCOPE, "openid", "email"];

const REFRESH_TOKEN_KEY = "avent_drive_refresh_token";
const ACCOUNT_EMAIL_KEY = "avent_drive_account_email";

/** Refresh this many ms before the token actually dies, so an upload that takes
 *  a while doesn't start with a token that expires mid-transfer. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export type DriveAuthErrorCode =
  | "not_configured"
  | "not_connected"
  | "cancelled"
  | "scope_denied"
  | "refresh_failed";

export class DriveAuthError extends Error {
  code: DriveAuthErrorCode;
  constructor(code: DriveAuthErrorCode, message: string) {
    super(message);
    this.name = "DriveAuthError";
    this.code = code;
  }
}

// ─── Token storage ─────────────────────────────────────────────────────────
// The refresh token is a long-lived credential for someone's Google account, so
// it belongs in the Keychain / Android Keystore, not AsyncStorage. SecureStore
// has no web implementation; the AsyncStorage fallback exists only so the web
// build doesn't crash at runtime — Drive backup is a mobile feature.

const useSecureStore = Platform.OS === "ios" || Platform.OS === "android";

async function secureGet(key: string): Promise<string | null> {
  try {
    return useSecureStore
      ? await SecureStore.getItemAsync(key)
      : await AsyncStorage.getItem(key);
  } catch (err) {
    console.warn("[drive-auth] token read failed:", err);
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (useSecureStore) {
    await SecureStore.setItemAsync(key, value);
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    if (useSecureStore) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    // Already gone — disconnect() must stay idempotent.
  }
}

// ─── Client configuration ──────────────────────────────────────────────────

/**
 * Google issues a *separate* OAuth client per platform, and the redirect scheme
 * is derived from whichever one is in use — so this cannot be a single shared id.
 */
export function getClientId(): string {
  const id =
    Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID
      : process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID;

  if (!id) {
    throw new DriveAuthError(
      "not_configured",
      `Google Drive backup isn't configured for this build (missing EXPO_PUBLIC_GOOGLE_OAUTH_${
        Platform.OS === "ios" ? "IOS" : "ANDROID"
      }_CLIENT_ID). See BACKUP_AND_AUTH_SETUP.md.`
    );
  }
  return id;
}

/** True when the build has the client id it needs — used to hide the feature
 *  rather than let a user tap into a guaranteed error. */
export function isDriveConfigured(): boolean {
  try {
    getClientId();
    return true;
  } catch {
    return false;
  }
}

/**
 * `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`
 *
 * This is the *iOS* convention. An iOS OAuth client calls back on a custom
 * scheme equal to the reversed client id; Android does not work this way at
 * all — see getRedirectUri.
 */
function reversedClientIdScheme(clientId: string): string {
  const base = clientId.replace(/\.apps\.googleusercontent\.com$/, "");
  return `com.googleusercontent.apps.${base}`;
}

/**
 * The redirect scheme is per-platform, and the wrong one is rejected before the
 * consent screen is ever drawn — Google answers with its own "Access blocked"
 * page, which is not an error this code ever gets to see or explain.
 *
 * An Android OAuth client has no redirect URL field to register: Google
 * identifies the app by package name + signing SHA-1, and only calls back on a
 * custom scheme equal to that package name. Handing it a reversed client id is
 * the iOS pattern, and is rejected with redirect_uri_mismatch.
 *
 * Whatever this returns must also be listed in app.json's `scheme` array, or the
 * OS has nothing registered to route the callback to and the browser tab just
 * sits there after consent.
 *
 * Built by hand rather than via `AuthSession.makeRedirectUri()`, whose defaults
 * mostly exist to paper over Expo Go and web — neither of which can receive a
 * native callback anyway, so Drive backup needs a dev or EAS build regardless.
 */
function getRedirectUri(clientId: string): string {
  if (Platform.OS === "ios") {
    return `${reversedClientIdScheme(clientId)}:/oauth2redirect`;
  }

  const packageName = Constants.expoConfig?.android?.package;
  if (!packageName) {
    throw new DriveAuthError(
      "not_configured",
      "Couldn't read the Android package name from the app config, so the Google redirect URI can't be built."
    );
  }
  return `${packageName}:/oauth2redirect`;
}

// ─── Access token cache ────────────────────────────────────────────────────
// Access tokens live ~1h and are worthless once expired, so they stay in memory
// only. Persisting them would add a second secret to protect for no benefit:
// the refresh token can always mint another one.

let cachedAccessToken: string | null = null;
let cachedExpiresAt = 0;

/**
 * Runs the consent screen and stores the resulting refresh token.
 *
 * `access_type=offline` + `prompt=consent` is what makes Google return a refresh
 * token at all. Without them the app gets one hour of access and then silently
 * stops backing up — which is the worst possible failure for a backup feature,
 * because the user has no reason to suspect anything broke.
 */
export async function connectDrive(): Promise<{ email: string | null }> {
  const clientId = getClientId();
  const redirectUri = getRedirectUri(clientId);

  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
  });

  const result = await request.promptAsync(DISCOVERY);

  if (result.type === "cancel" || result.type === "dismiss") {
    throw new DriveAuthError("cancelled", "Google sign-in was cancelled.");
  }
  if (result.type !== "success" || !result.params.code) {
    const detail = (result as any)?.params?.error_description ?? result.type;
    throw new DriveAuthError("refresh_failed", `Google sign-in failed: ${detail}`);
  }

  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      // Installed apps are public clients: there is no client secret to send,
      // PKCE is what proves this is the same app that started the flow.
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    DISCOVERY
  );

  if (!tokens.refreshToken) {
    // Happens if the user previously granted consent and Google decides not to
    // re-issue. `prompt=consent` above is meant to prevent it; if it still
    // happens, failing loudly beats storing an hour-long credential and calling
    // the device "connected".
    throw new DriveAuthError(
      "refresh_failed",
      "Google didn't return a refresh token. Remove Avent from your Google Account permissions and connect again."
    );
  }

  // Google renders a checkbox per non-required permission, and "Allow" with the
  // Drive box left unticked still returns a perfectly valid token — one that 403s
  // on every Drive call. Without this check the app stores that token, reports
  // itself connected, shows the account address, and then fails every backup with
  // a raw API error that says nothing about the cause.
  //
  // Only enforced when Google actually tells us what it granted; an absent
  // `scope` field is not evidence of a denial.
  const grantedScopes = tokens.scope ? tokens.scope.split(" ") : [];
  if (grantedScopes.length > 0 && !grantedScopes.includes(DRIVE_SCOPE)) {
    throw new DriveAuthError(
      "scope_denied",
      "Google Drive access wasn't granted. Connect again and leave the Drive permission ticked on Google's consent screen."
    );
  }

  await secureSet(REFRESH_TOKEN_KEY, tokens.refreshToken);

  cachedAccessToken = tokens.accessToken;
  cachedExpiresAt = Date.now() + (tokens.expiresIn ?? 3600) * 1000;

  const email = extractEmailFromIdToken(tokens.idToken);
  if (email) await secureSet(ACCOUNT_EMAIL_KEY, email);

  return { email };
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes base64url without `atob`.
 *
 * Hermes does not guarantee a global `atob`, and adding a base64 package for one
 * JWT payload isn't worth a dependency. Only the ASCII range matters here — the
 * one field read out of the payload is an email address.
 */
function decodeBase64Url(input: string): string {
  const normalised = input.replace(/-/g, "+").replace(/_/g, "/");
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const char of normalised) {
    if (char === "=") break;
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return out;
}

/**
 * Pulls the account address out of the id token purely to show "Backing up to
 * name@gmail.com" in the UI. Signature verification is skipped on purpose: this
 * token came straight from Google's token endpoint over TLS and is used for a
 * display string, never for an authorization decision.
 */
function extractEmailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(decodeBase64Url(payload));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

export async function isDriveConnected(): Promise<boolean> {
  return Boolean(await secureGet(REFRESH_TOKEN_KEY));
}

export async function getConnectedEmail(): Promise<string | null> {
  return secureGet(ACCOUNT_EMAIL_KEY);
}

/**
 * Returns a usable access token, refreshing if needed.
 *
 * A revoked grant surfaces here as `invalid_grant`. That is unrecoverable
 * without user action, so the stored refresh token is deleted — otherwise the
 * app would report itself connected forever while every backup failed.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedExpiresAt - EXPIRY_SKEW_MS) {
    return cachedAccessToken;
  }

  const refreshToken = await secureGet(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    throw new DriveAuthError(
      "not_connected",
      "Google Drive isn't connected yet."
    );
  }

  try {
    const tokens = await AuthSession.refreshAsync(
      { clientId: getClientId(), refreshToken },
      DISCOVERY
    );

    cachedAccessToken = tokens.accessToken;
    cachedExpiresAt = Date.now() + (tokens.expiresIn ?? 3600) * 1000;

    // Google sometimes rotates the refresh token; persisting the new one keeps
    // the connection alive past the old one's revocation.
    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      await secureSet(REFRESH_TOKEN_KEY, tokens.refreshToken);
    }

    return tokens.accessToken;
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (message.includes("invalid_grant")) {
      await secureDelete(REFRESH_TOKEN_KEY);
      await secureDelete(ACCOUNT_EMAIL_KEY);
      cachedAccessToken = null;
      cachedExpiresAt = 0;
      throw new DriveAuthError(
        "not_connected",
        "Google Drive access was revoked. Please connect again."
      );
    }
    throw new DriveAuthError(
      "refresh_failed",
      `Couldn't refresh Google Drive access: ${message}`
    );
  }
}

/**
 * Drops local credentials and asks Google to revoke the grant.
 *
 * Local state is cleared regardless of whether the revoke call succeeds — a
 * user who taps "Disconnect" offline must not still be treated as connected.
 */
export async function disconnectDrive(): Promise<void> {
  const refreshToken = await secureGet(REFRESH_TOKEN_KEY);

  cachedAccessToken = null;
  cachedExpiresAt = 0;
  await secureDelete(REFRESH_TOKEN_KEY);
  await secureDelete(ACCOUNT_EMAIL_KEY);

  if (refreshToken) {
    try {
      await AuthSession.revokeAsync(
        { token: refreshToken, clientId: getClientId() },
        DISCOVERY
      );
    } catch (err) {
      console.warn("[drive-auth] revoke failed (local state cleared):", err);
    }
  }
}
