/**
 * Live API key checks, runnable from inside the app.
 *
 * `scripts/test-api-keys.mjs` does the same thing from a terminal, but running
 * these on-device matters for a mobile app: Google Cloud keys are commonly
 * restricted per platform (Android apps + SHA-1 fingerprint, iOS bundle id), so
 * a key that passes from a laptop can still be rejected from the actual app.
 * These checks exercise the same endpoints the app really calls.
 *
 * Each check is cheap and read-only. Nothing here writes data.
 */

export type CheckStatus = "pass" | "fail" | "missing" | "skipped";

export interface KeyCheckResult {
  name: string;
  envVar: string;
  status: CheckStatus;
  detail: string;
}

const TIMEOUT_MS = 15000;

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message =
        body?.error?.message ??
        body?.error_message ??
        body?.error?.info ??
        body?.message ??
        (typeof body === "string" ? body.slice(0, 160) : `HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}: ${message}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck(
  name: string,
  envVar: string,
  key: string | undefined,
  fn: (key: string) => Promise<string>
): Promise<KeyCheckResult> {
  if (!key) {
    return { name, envVar, status: "missing", detail: "not set in .env" };
  }
  try {
    return { name, envVar, status: "pass", detail: await fn(key) };
  } catch (err) {
    return {
      name,
      envVar,
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkAllApiKeys(): Promise<KeyCheckResult[]> {
  const firebaseKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const googleKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

  const checks = await Promise.all([
    // Firebase Auth. The Identity Toolkit config endpoint is the cheapest call
    // that actually validates the key against the project.
    runCheck(
      "Firebase Auth",
      "EXPO_PUBLIC_FIREBASE_API_KEY",
      firebaseKey,
      async (key) => {
        const body = await fetchJson(
          `https://identitytoolkit.googleapis.com/v1/projects?key=${key}`
        );
        return `authorized domains: ${(body?.authorizedDomains ?? []).join(", ") || "none"}`;
      }
    ),

    // Firestore is only used for the entitlement doc now. An unauthenticated
    // read of UserTrips SHOULD be denied — if it succeeds, firestore.rules
    // hasn't been deployed and the collection is world-readable.
    //
    // Note this check needs BOTH the project id and the API key: a 403 caused
    // by a bad key looks identical to a 403 caused by correct rules, so without
    // distinguishing them wide-open rules could be reported as a pass.
    runCheck(
      "Firestore rules",
      "EXPO_PUBLIC_FIREBASE_PROJECT_ID + API_KEY",
      projectId && firebaseKey ? projectId : undefined,
      async (id) => {
        const url = `https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/documents/UserTrips?pageSize=1&key=${firebaseKey}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (res.ok) {
            throw new Error(
              "UNAUTHENTICATED READS ARE ALLOWED — deploy firestore.rules (firebase deploy --only firestore:rules)"
            );
          }
          const body = await res.json().catch(() => ({}));
          const message: string = body?.error?.message ?? "";
          if (/API key not valid|API_KEY_INVALID|api key/i.test(message)) {
            throw new Error(`can't tell — the API key was rejected: ${message}`);
          }
          if (res.status === 401 || res.status === 403) {
            return "unauthenticated reads correctly denied";
          }
          throw new Error(`unexpected HTTP ${res.status}: ${message}`);
        } finally {
          clearTimeout(timer);
        }
      }
    ),

    runCheck(
      "Gemini AI",
      "EXPO_PUBLIC_GEMINI_API_KEY",
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
      async (key) => {
        const body = await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
        );
        const names: string[] = (body?.models ?? []).map((m: any) =>
          String(m.name).replace("models/", "")
        );
        const hasModel = names.some((n) => n.includes("gemini-2.5-flash"));
        return `${names.length} models; gemini-2.5-flash ${hasModel ? "available" : "MISSING"}`;
      }
    ),

    runCheck(
      "Google Places",
      "EXPO_PUBLIC_GOOGLE_MAP_KEY",
      googleKey,
      async (key) => {
        const body = await fetchJson(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Lahore&key=${key}`
        );
        if (body.status === "OK" || body.status === "ZERO_RESULTS") {
          return `status=${body.status}`;
        }
        throw new Error(`${body.status}: ${body.error_message ?? ""}`);
      }
    ),

    runCheck(
      "Google Geocoding",
      "EXPO_PUBLIC_GOOGLE_MAP_KEY",
      googleKey,
      async (key) => {
        const body = await fetchJson(
          `https://maps.googleapis.com/maps/api/geocode/json?address=Lahore&key=${key}`
        );
        if (body.status === "OK") return "status=OK";
        throw new Error(`${body.status}: ${body.error_message ?? ""}`);
      }
    ),

    runCheck(
      "Unsplash",
      "EXPO_PUBLIC_UNSPLASH_ACCESS_KEY",
      process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY,
      async (key) => {
        // Same auth header style the app uses in generate-trip.tsx.
        const body = await fetchJson(
          "https://api.unsplash.com/search/photos?query=paris&per_page=1",
          { headers: { Authorization: `Client-ID ${key}` } }
        );
        return `${body?.total ?? 0} results for "paris"`;
      }
    ),

    runCheck(
      "WeatherAPI.com",
      "EXPO_PUBLIC_WEATHERAPI_KEY",
      process.env.EXPO_PUBLIC_WEATHERAPI_KEY,
      async (key) => {
        const body = await fetchJson(
          `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=Lahore&days=3&aqi=no&alerts=no`
        );
        return `${body?.location?.name}: ${body?.current?.temp_c}°C, ${
          body?.forecast?.forecastday?.length ?? 0
        }-day forecast`;
      }
    ),

    // Billing verification. A 401/403 means deployed-and-rejecting-anonymous,
    // which is exactly right; a 404 means it was never deployed.
    runCheck(
      "Cloud Function verifyPurchase",
      "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
      projectId,
      async (id) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(
            `https://us-central1-${id}.cloudfunctions.net/verifyPurchase`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ data: {} }),
              signal: controller.signal,
            }
          );
          if (res.status === 404) {
            throw new Error(
              "NOT DEPLOYED (404) — run: firebase deploy --only functions"
            );
          }
          return `deployed (HTTP ${res.status} for an unauthenticated call)`;
        } finally {
          clearTimeout(timer);
        }
      }
    ),
  ]);

  return checks;
}
