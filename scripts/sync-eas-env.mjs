#!/usr/bin/env node
/**
 * Push the API keys from .env up to EAS, so EAS builds actually have them.
 *
 * Why this exists
 * ───────────────
 * `.env` is in .gitignore, and EAS Build uploads the project from git. So the
 * file never reaches the build server: every `process.env.EXPO_PUBLIC_*` read
 * compiles to `undefined` and the APK dies with errors like
 * "Missing EXPO_PUBLIC_WEATHERAPI_KEY". Storing the keys as EAS environment
 * variables fixes that without committing them to the repo.
 *
 * Usage
 *   node scripts/sync-eas-env.mjs                 # dry run — prints the plan
 *   node scripts/sync-eas-env.mjs --apply         # push to preview + production
 *   node scripts/sync-eas-env.mjs --apply --environment preview
 *
 * Requires: npm i -g eas-cli && eas login
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");

/**
 * Keys the app reads at runtime and that must exist on the build server.
 * Flags (DEMO_MODE, BILLING_BYPASS, FORCE_TELEMETRY_IN_DEV) are deliberately
 * absent: those are pinned per-profile in eas.json so a stray local `true`
 * can never ship in a release build.
 */
const SYNCED_KEYS = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
  "EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID",
  "EXPO_PUBLIC_GEMINI_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAP_KEY",
  "EXPO_PUBLIC_UNSPLASH_ACCESS_KEY",
  "EXPO_PUBLIC_WEATHERAPI_KEY",
  "EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID",
];

/**
 * Keys the app runs fine without. They are still pushed when present, but a
 * missing value is reported as a note rather than failing the dry run — an
 * iOS-only client id is genuinely irrelevant to an Android-only build.
 */
const OPTIONAL_KEYS = new Set([
  "EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID",
]);

/** Set in eas.json instead — listed so the script can explain the omission. */
const PINNED_IN_EAS_JSON = [
  "EXPO_PUBLIC_DEMO_MODE",
  "EXPO_PUBLIC_BILLING_BYPASS",
  "EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV",
];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return null;
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

function mask(v) {
  if (!v) return "(empty)";
  return v.length <= 10 ? `${v.slice(0, 3)}***` : `${v.slice(0, 8)}…${v.slice(-4)}`;
}

// ─── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const envIndex = argv.indexOf("--environment");
const environments =
  envIndex !== -1 && argv[envIndex + 1]
    ? [argv[envIndex + 1]]
    : ["preview", "production"];

for (const e of environments) {
  if (!["development", "preview", "production"].includes(e)) {
    console.error(`${RED}Unknown environment "${e}".${RESET} Use development, preview or production.`);
    process.exit(1);
  }
}

// ─── read .env ──────────────────────────────────────────────────────────────
const env = parseEnvFile(ENV_FILE);
if (!env) {
  console.error(`${RED}No .env at ${ENV_FILE}${RESET}`);
  console.error(`Copy .env.example to .env and fill in your keys first.`);
  process.exit(1);
}

const present = SYNCED_KEYS.filter((k) => env[k]);
const missing = SYNCED_KEYS.filter((k) => !env[k]);

console.log(`${BOLD}EAS environment sync${RESET}  ${DIM}(${ENV_FILE})${RESET}`);
console.log(`${DIM}environments: ${environments.join(", ")}${RESET}\n`);

for (const k of present) {
  console.log(`  ${GREEN}✓${RESET} ${k.padEnd(42)} ${DIM}${mask(env[k])}${RESET}`);
}
for (const k of missing) {
  const optional = OPTIONAL_KEYS.has(k);
  console.log(
    `  ${optional ? YELLOW : RED}${optional ? "–" : "✗"}${RESET} ${k.padEnd(42)} ${DIM}not set in .env — will be skipped${optional ? " (optional)" : ""}${RESET}`
  );
}
console.log(
  `\n${DIM}Pinned in eas.json, not synced: ${PINNED_IN_EAS_JSON.join(", ")}${RESET}`
);

if (!apply) {
  console.log(
    `\n${YELLOW}Dry run.${RESET} Re-run with ${BOLD}--apply${RESET} to push these to EAS.`
  );
  process.exit(missing.some((k) => !OPTIONAL_KEYS.has(k)) ? 1 : 0);
}

if (!present.length) {
  console.error(`\n${RED}Nothing to push.${RESET}`);
  process.exit(1);
}

// ─── push ───────────────────────────────────────────────────────────────────
// `sensitive` hides the value in the EAS dashboard and build logs while still
// letting builds read it. Note that EXPO_PUBLIC_* values are inlined into the
// JS bundle by design, so anyone with the APK can still extract them — treat
// these keys as public and restrict them provider-side (HTTP referrer /
// Android package + SHA-1 / per-key quotas).
const easCmd = process.platform === "win32" ? "eas.cmd" : "eas";
let failures = 0;

console.log("");
for (const environment of environments) {
  console.log(`${BOLD}→ ${environment}${RESET}`);
  for (const key of present) {
    const args = [
      "env:create",
      "--scope", "project",
      "--name", key,
      "--value", env[key],
      "--environment", environment,
      "--visibility", "sensitive",
      "--type", "string",
      "--force",
      "--non-interactive",
    ];
    const res = spawnSync(easCmd, args, { encoding: "utf8", shell: process.platform === "win32" });

    if (res.error) {
      console.error(
        `  ${RED}✗${RESET} ${key}  ${DIM}${res.error.code === "ENOENT" ? "eas-cli not found — npm i -g eas-cli" : res.error.message}${RESET}`
      );
      failures++;
      if (res.error.code === "ENOENT") process.exit(1);
      continue;
    }
    if (res.status === 0) {
      console.log(`  ${GREEN}✓${RESET} ${key}`);
    } else {
      const detail = `${res.stderr || res.stdout || ""}`.trim().split("\n").slice(-2).join(" ").slice(0, 180);
      console.error(`  ${RED}✗${RESET} ${key}  ${DIM}${detail}${RESET}`);
      failures++;
    }
  }
}

console.log(
  failures
    ? `\n${RED}${failures} failed.${RESET} Check you ran ${BOLD}eas login${RESET} and that the project id in app.json matches your account.`
    : `\n${GREEN}Done.${RESET} Verify with: ${BOLD}eas env:list --environment ${environments[0]}${RESET}`
);
process.exit(failures ? 1 : 0);
