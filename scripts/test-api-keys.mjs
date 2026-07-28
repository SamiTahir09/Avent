#!/usr/bin/env node
/**
 * Live API key smoke test.
 *
 * Reads .env from the project root and fires one real, cheap request per
 * service so you can tell a *misconfigured* key apart from a *missing* one.
 *
 * Usage:  node scripts/test-api-keys.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── .env loader (no dependency on dotenv) ─────────────────────────────────
function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const results = [];

function mask(v) {
  if (!v) return "(empty)";
  if (v.length <= 10) return `${v.slice(0, 3)}***`;
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}

async function check(name, envVar, fn) {
  const key = Array.isArray(envVar)
    ? envVar.map((k) => env[k]).find(Boolean)
    : env[envVar];
  const label = Array.isArray(envVar) ? envVar.join(" | ") : envVar;

  if (!key) {
    results.push({ name, label, status: "MISSING", detail: "not set in .env" });
    return;
  }
  try {
    const detail = await fn(key);
    results.push({ name, label, status: "PASS", detail: detail || "ok", key });
  } catch (err) {
    results.push({
      name,
      label,
      status: "FAIL",
      detail: err?.message?.slice(0, 220) || String(err),
      key,
    });
  }
}

async function json(url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body?.error?.message ||
      body?.error?.error_message ||
      body?.error_message ||
      body?.message ||
      (typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200));
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return body;
}

// ─── Individual checks ────────────────────────────────────────────────────

// 1. Firebase Web API key — hit the Identity Toolkit config endpoint.
//    A valid key returns the sign-in provider config for the project.
async function firebaseAuth(key) {
  const body = await json(
    `https://identitytoolkit.googleapis.com/v1/projects?key=${key}`
  );
  const providers = body?.signIn ?? {};
  const emailEnabled = providers?.email?.enabled;
  return `project=${body?.projectId ?? "?"} emailPasswordSignIn=${
    emailEnabled === undefined ? "unknown" : emailEnabled
  } anonymous=${providers?.anonymous?.enabled ?? false}`;
}

// 2. Firestore reachability via the REST API (rules will deny unauthenticated
//    reads — a 403 PERMISSION_DENIED actually proves the project + key work).
async function firestore(key) {
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("EXPO_PUBLIC_FIREBASE_PROJECT_ID not set");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/UserTrips?pageSize=1&key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 401) {
    const msg = body?.error?.message || "";
    if (/Missing or insufficient permissions|PERMISSION_DENIED/i.test(msg)) {
      return "reachable; rules correctly deny unauthenticated reads";
    }
    if (/API has not been used|disabled/i.test(msg)) {
      throw new Error(`Firestore API disabled for project: ${msg}`);
    }
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body?.error?.message || "unknown"}`);
  }
  return "reachable; UNAUTHENTICATED READS ARE ALLOWED — tighten firestore.rules";
}

// 3. Gemini
async function gemini(key) {
  const body = await json(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
  );
  const models = (body?.models ?? []).map((m) => m.name.replace("models/", ""));
  const has = models.some((m) => m.includes("gemini-2.5-flash"));
  return `${models.length} models visible; gemini-2.5-flash ${
    has ? "available" : "NOT in list"
  }`;
}

// 4. Google Places (the app uses Places Autocomplete + Place Photos)
async function places(key) {
  const body = await json(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Lahore&key=${key}`
  );
  if (body.status === "OK" || body.status === "ZERO_RESULTS") {
    return `Places Autocomplete status=${body.status} (${
      body.predictions?.length ?? 0
    } predictions)`;
  }
  throw new Error(`${body.status}: ${body.error_message || "no error_message"}`);
}

// 5. Google Geocoding (used by utils/coordinates)
async function geocoding(key) {
  const body = await json(
    `https://maps.googleapis.com/maps/api/geocode/json?address=Lahore&key=${key}`
  );
  if (body.status === "OK") return `Geocoding status=OK`;
  throw new Error(`${body.status}: ${body.error_message || "no error_message"}`);
}

// 6. Unsplash
async function unsplash(key) {
  const body = await json(
    `https://api.unsplash.com/search/photos?query=paris&per_page=1&client_id=${key}`
  );
  return `${body?.total ?? 0} results for "paris"`;
}

// 7. WeatherAPI.com
async function weatherapi(key) {
  const body = await json(
    `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=Lahore&days=3&aqi=no&alerts=no`
  );
  return `${body?.location?.name}: ${body?.current?.temp_c}°C, ${
    body?.forecast?.forecastday?.length ?? 0
  }-day forecast`;
}

// 8. Firebase Cloud Functions region reachability (billing verification)
async function cloudFunctions() {
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("EXPO_PUBLIC_FIREBASE_PROJECT_ID not set");
  const url = `https://us-central1-${projectId}.cloudfunctions.net/verifyPurchase`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) {
    throw new Error("verifyPurchase NOT DEPLOYED (404) — run: firebase deploy --only functions");
  }
  // 401/403 = deployed and correctly rejecting an unauthenticated call.
  if (res.status === 401 || res.status === 403) {
    return "deployed; rejects unauthenticated calls (expected)";
  }
  const text = await res.text();
  if (/UNAUTHENTICATED|unauthenticated/.test(text)) {
    return "deployed; rejects unauthenticated calls (expected)";
  }
  return `deployed; HTTP ${res.status} ${text.slice(0, 100)}`;
}

// ─── Run ──────────────────────────────────────────────────────────────────
console.log(`\n${DIM}Reading ${path.join(ROOT, ".env")}${RESET}`);
console.log(`${DIM}Running live requests…${RESET}\n`);

await check("Firebase Auth (Identity Toolkit)", "EXPO_PUBLIC_FIREBASE_API_KEY", firebaseAuth);
await check("Firestore REST + rules", "EXPO_PUBLIC_FIREBASE_API_KEY", firestore);
await check("Cloud Functions (verifyPurchase)", "EXPO_PUBLIC_FIREBASE_PROJECT_ID", cloudFunctions);
await check("Gemini AI", "EXPO_PUBLIC_GEMINI_API_KEY", gemini);
await check("Google Places Autocomplete", ["EXPO_PUBLIC_GOOGLE_MAP_KEY", "EXPO_PUBLIC_GOOGLE_API_KEY"], places);
await check("Google Geocoding", ["EXPO_PUBLIC_GOOGLE_MAP_KEY", "EXPO_PUBLIC_GOOGLE_API_KEY"], geocoding);
await check("Unsplash", "EXPO_PUBLIC_UNSPLASH_ACCESS_KEY", unsplash);
await check("WeatherAPI.com", "EXPO_PUBLIC_WEATHERAPI_KEY", weatherapi);

// ─── Report ───────────────────────────────────────────────────────────────
const pad = Math.max(...results.map((r) => r.name.length));
console.log("─".repeat(pad + 60));
for (const r of results) {
  const colour =
    r.status === "PASS" ? GREEN : r.status === "MISSING" ? YELLOW : RED;
  const icon = r.status === "PASS" ? "✓" : r.status === "MISSING" ? "○" : "✗";
  console.log(
    `${colour}${icon} ${r.status.padEnd(7)}${RESET} ${r.name.padEnd(pad)}  ${r.detail}`
  );
  if (r.key) console.log(`${DIM}${" ".repeat(11)}${r.label} = ${mask(r.key)}${RESET}`);
}
console.log("─".repeat(pad + 60));

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const missing = results.filter((r) => r.status === "MISSING").length;
console.log(
  `${GREEN}${pass} pass${RESET}  ${RED}${fail} fail${RESET}  ${YELLOW}${missing} missing${RESET}\n`
);

process.exit(fail > 0 ? 1 : 0);
