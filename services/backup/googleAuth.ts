import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as WebBrowser from "expo-web-browser";

import { getMeta, setMeta } from "@/services/db";
import {
  base64UrlDecodeToString,
  createPkcePair,
  createStateToken,
} from "@/utils/pkce";

/**
 * Google OAuth for the Drive backup feature.
 *
 * Implemented directly on top of expo-web-browser rather than
 * expo-auth-session because both expo-auth-session and its expo-crypto peer
 * ship native code: adding them would mean every installed dev build and APK
 * has to be rebuilt before backup works. This module needs nothing that isn't
 * already in the dependency list.
 *
 * The flow is the RFC 8252 native-app flow: authorization code + PKCE (S256),
 * no client secret, redirecting to the reversed-client-id custom scheme. The
 * refresh token is stored in SQLite's `meta` table — the same place the rest of
 * the app's durable local state lives.
 *
 * Scope is deliberately the *narrowest* Drive scope that exists:
 * `drive.appdata` can only see a hidden per-app folder. It cannot read, list or
 * touch a single one of the user's own files, and it is not a restricted scope,
 * so it needs no Google verification review.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export const DRIVE_APPDATA_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";

const SCOPES = [DRIVE_APPDATA_SCOPE, "openid", "email"];

const TOKENS_META_KEY = "google_backup_tokens_v1";

/** Refresh a little early so a request can't expire mid-flight. */
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

export type GoogleAuthErrorCode =
  | "not_configured"
  | "unsupported_client"
  | "not_connected"
  | "cancelled"
  | "state_mismatch"
  | "network"
  | "google_error";

export class GoogleAuthError extends Error {
  code: GoogleAuthErrorCode;
  constructor(code: GoogleAuthErrorCode, message: string) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
  email: string | null;
}

// ─── Configuration ─────────────────────────────────────────────────────────

/**
 * Read as two separate literal `process.env.X` expressions on purpose: Expo
 * inlines EXPO_PUBLIC_* at build time by *textual* substitution, so a dynamic
 * lookup like process.env[key] evaluates to undefined in a release bundle.
 */
function getClientId(): string | null {
  const id =
    Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID
      : process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID;
  return id && id.trim() ? id.trim() : null;
}

/**
 * `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`.
 * Google only accepts this exact reversed form as the redirect scheme for
 * iOS/Android OAuth clients.
 */
export function reversedClientScheme(clientId: string): string {
  const prefix = clientId.replace(/\.apps\.googleusercontent\.com$/, "");
  return `com.googleusercontent.apps.${prefix}`;
}

function getRedirectUri(clientId: string): string {
  return `${reversedClientScheme(clientId)}:/oauth2redirect`;
}

/** True once the OAuth client id is present for this platform. */
export function isBackupConfigured(): boolean {
  return getClientId() !== null;
}

/**
 * Expo Go can't own a custom URL scheme, so the redirect would never come back
 * to the app. Caught here to produce one clear message instead of a hang.
 */
function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/** The scheme that must be registered in app.json for the redirect to land. */
export function getRequiredScheme(): string | null {
  const clientId = getClientId();
  return clientId ? reversedClientScheme(clientId) : null;
}

/**
 * Whether the OS will actually hand the redirect back to this app.
 *
 * Without the reversed-client-id scheme in `expo.scheme`, Google's redirect
 * goes nowhere: the browser sheet just sits there and the flow eventually
 * resolves as "dismissed", which looks exactly like the user changing their
 * mind. Checking up front turns that into a message naming the missing line.
 */
function isSchemeRegistered(scheme: string): boolean {
  const configured = Constants.expoConfig?.scheme;
  if (!configured) return false;
  return Array.isArray(configured)
    ? configured.includes(scheme)
    : configured === scheme;
}

// ─── Token storage ─────────────────────────────────────────────────────────

async function readTokens(): Promise<StoredTokens | null> {
  const raw = await getMeta(TOKENS_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    return parsed.refreshToken || parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

async function writeTokens(tokens: StoredTokens | null): Promise<void> {
  await setMeta(TOKENS_META_KEY, tokens ? JSON.stringify(tokens) : "");
}

export interface GoogleAccountStatus {
  connected: boolean;
  email: string | null;
  configured: boolean;
}

export async function getAccountStatus(): Promise<GoogleAccountStatus> {
  const tokens = await readTokens();
  return {
    connected: Boolean(tokens),
    email: tokens?.email ?? null,
    configured: isBackupConfigured(),
  };
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
}

function parseQuery(url: string): Record<string, string> {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return {};
  const out: Record<string, string> = {};
  for (const pair of url.slice(queryStart + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
    out[key] = value;
  }
  return out;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode(body),
    });
  } catch (err) {
    throw new GoogleAuthError(
      "network",
      `Could not reach Google: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    throw new GoogleAuthError(
      "google_error",
      json.error_description ?? json.error ?? `Google returned ${response.status}`
    );
  }
  return json;
}

/** Pulls the email out of the id_token without a second network round-trip. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(base64UrlDecodeToString(payload));
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

// ─── Public flow ───────────────────────────────────────────────────────────

/**
 * Opens the Google consent screen and stores the resulting tokens.
 * Resolves with the connected account's email (null if Google withheld it).
 */
export async function connectGoogleAccount(): Promise<string | null> {
  const clientId = getClientId();
  if (!clientId) {
    throw new GoogleAuthError(
      "not_configured",
      `Google backup is not configured: EXPO_PUBLIC_GOOGLE_OAUTH_${
        Platform.OS === "ios" ? "IOS" : "ANDROID"
      }_CLIENT_ID is missing. See GOOGLE_BACKUP_SETUP.md.`
    );
  }
  if (isExpoGo()) {
    throw new GoogleAuthError(
      "unsupported_client",
      "Google backup needs a development build or APK — Expo Go cannot receive the OAuth redirect."
    );
  }

  const scheme = reversedClientScheme(clientId);
  if (!isSchemeRegistered(scheme)) {
    throw new GoogleAuthError(
      "not_configured",
      `app.json does not register the redirect scheme "${scheme}". Add it to expo.scheme and rebuild — see GOOGLE_BACKUP_SETUP.md.`
    );
  }

  const redirectUri = getRedirectUri(clientId);
  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = createStateToken();

  const authUrl =
    `${AUTH_ENDPOINT}?` +
    formEncode({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      // Without offline access Google returns no refresh token, and the
      // connection would silently die an hour later. `prompt=consent` forces a
      // refresh token even when the user has approved this app before.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== "success") {
    throw new GoogleAuthError("cancelled", "Google sign-in was cancelled.");
  }

  const params = parseQuery(result.url);

  if (params.state !== state) {
    // Someone (or something) sent a redirect we didn't initiate.
    throw new GoogleAuthError(
      "state_mismatch",
      "Google sign-in could not be verified. Please try again."
    );
  }
  if (params.error) {
    throw new GoogleAuthError(
      params.error === "access_denied" ? "cancelled" : "google_error",
      params.error_description ?? params.error
    );
  }
  if (!params.code) {
    throw new GoogleAuthError("google_error", "Google did not return an authorization code.");
  }

  const tokenResponse = await postToken({
    client_id: clientId,
    code: params.code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  if (!tokenResponse.access_token) {
    throw new GoogleAuthError("google_error", "Google did not return an access token.");
  }

  const grantedScopes = tokenResponse.scope ?? "";
  if (grantedScopes && !grantedScopes.includes(DRIVE_APPDATA_SCOPE)) {
    // The user can untick individual permissions on the consent screen. Better
    // to fail here than to let them think backup is on and find out later.
    throw new GoogleAuthError(
      "google_error",
      "Drive permission was not granted, so backups cannot be saved."
    );
  }

  const email =
    emailFromIdToken(tokenResponse.id_token) ??
    (await fetchEmail(tokenResponse.access_token));

  await writeTokens({
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token ?? null,
    expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
    scope: grantedScopes || SCOPES.join(" "),
    email,
  });

  return email;
}

/**
 * A valid access token, refreshed on demand.
 * Throws GoogleAuthError("not_connected") when the user must sign in again.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) {
    throw new GoogleAuthError("not_connected", "No Google account is connected.");
  }

  if (tokens.accessToken && tokens.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return tokens.accessToken;
  }

  const clientId = getClientId();
  if (!tokens.refreshToken || !clientId) {
    await writeTokens(null);
    throw new GoogleAuthError(
      "not_connected",
      "The Google connection expired. Please connect again."
    );
  }

  let refreshed: TokenResponse;
  try {
    refreshed = await postToken({
      client_id: clientId,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    });
  } catch (err) {
    // A network blip must not wipe a perfectly good refresh token — only an
    // outright rejection from Google means the grant is really gone.
    if (err instanceof GoogleAuthError && err.code === "google_error") {
      await writeTokens(null);
      throw new GoogleAuthError(
        "not_connected",
        "Google revoked the backup permission. Please connect again."
      );
    }
    throw err;
  }

  if (!refreshed.access_token) {
    await writeTokens(null);
    throw new GoogleAuthError("not_connected", "Google did not return a new access token.");
  }

  await writeTokens({
    ...tokens,
    accessToken: refreshed.access_token,
    // Google usually omits refresh_token on refresh; keep the existing one.
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
  });

  return refreshed.access_token;
}

/**
 * Forgets the connection locally and asks Google to drop the grant.
 * The local wipe happens regardless of whether the revoke call succeeds — the
 * user asked to disconnect, so the app must not keep usable tokens around.
 */
export async function disconnectGoogleAccount(): Promise<void> {
  const tokens = await readTokens();
  await writeTokens(null);

  const token = tokens?.refreshToken ?? tokens?.accessToken;
  if (!token) return;
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Offline disconnect is still a disconnect.
  }
}
