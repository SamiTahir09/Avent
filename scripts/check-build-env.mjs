#!/usr/bin/env node
/**
 * Pre-build guard: will this EAS profile actually have the keys the code reads?
 *
 * The failure this catches
 * ───────────────────────
 * Babel inlines every `process.env.EXPO_PUBLIC_*` read at bundle time. `.env`
 * is gitignored and EAS Build uploads the project from git, so a key that only
 * lives in `.env` compiles to `undefined` inside the APK — and you don't find
 * out until a screen throws "Missing EXPO_PUBLIC_WEATHERAPI_KEY" on a device.
 *
 * This script scans the source for every EXPO_PUBLIC_ read and checks each one
 * is supplied by either eas.json's `env` block or the EAS environment that the
 * profile points at (approximated by what sync-eas-env.mjs pushes from .env).
 *
 * Usage
 *   node scripts/check-build-env.mjs                    # checks preview + production
 *   node scripts/check-build-env.mjs --profile preview
 *
 * Exits non-zero if a required key would be missing — safe to chain:
 *   npm run check:build-env && eas build -p android --profile preview
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Keys the app can run without. Anything not listed here is treated as
 * required, so a newly added key fails the check until it's wired up.
 */
const OPTIONAL = {
  // Telemetry degrades to a local SQLite queue when this is absent.
  EXPO_PUBLIC_GA4_API_SECRET:
    "optional — without it analytics queues locally instead of posting to GA4",
};

/** Keys that are only ever read as a fallback for another key. */
const ALIASES = {
  EXPO_PUBLIC_GOOGLE_API_KEY: "EXPO_PUBLIC_GOOGLE_MAP_KEY",
};

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ─── what the code reads ────────────────────────────────────────────────────
function scanSourceForEnvReads() {
  const dirs = ["app", "components", "config", "services", "hooks", "store", "utils"].filter(
    (d) => fs.existsSync(path.join(ROOT, d))
  );
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z_0-9]+)/g)) {
          found.add(m[1]);
        }
      }
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  return found;
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** Keys sync-eas-env.mjs is configured to push — the single source of truth. */
function keysSyncedToEas() {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "sync-eas-env.mjs"), "utf8");
  const block = src.match(/const SYNCED_KEYS = \[([\s\S]*?)\];/);
  if (!block) return new Set();
  return new Set(block[1].match(/EXPO_PUBLIC_[A-Z_0-9]+/g) ?? []);
}

/** Ask EAS what's really stored, if the CLI is available and logged in. */
function keysLiveOnEas(environment) {
  try {
    const out = execSync(
      `eas env:list --environment ${environment} --non-interactive`,
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 }
    );
    return new Set(out.match(/EXPO_PUBLIC_[A-Z_0-9]+/g) ?? []);
  } catch {
    return null; // CLI missing, not logged in, or offline — fall back to .env
  }
}

// ─── run ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const profileIndex = argv.indexOf("--profile");
const profiles =
  profileIndex !== -1 && argv[profileIndex + 1]
    ? [argv[profileIndex + 1]]
    : ["preview", "production"];

const eas = JSON.parse(fs.readFileSync(path.join(ROOT, "eas.json"), "utf8"));
const localEnv = parseEnvFile(path.join(ROOT, ".env"));
const synced = keysSyncedToEas();
const used = scanSourceForEnvReads();

let totalFailures = 0;

for (const profile of profiles) {
  const cfg = eas.build?.[profile];
  if (!cfg) {
    console.error(`${RED}No build profile "${profile}" in eas.json${RESET}`);
    totalFailures++;
    continue;
  }

  const environment = cfg.environment;
  const inline = new Set(Object.keys(cfg.env ?? {}));
  const live = environment ? keysLiveOnEas(environment) : null;
  const remote =
    live ??
    new Set([...synced].filter((k) => localEnv[k])); // best-effort: what a sync would push

  console.log(
    `\n${BOLD}${profile}${RESET} ${DIM}→ environment: ${environment ?? "(none set!)"}${RESET}`
  );
  console.log(
    `${DIM}  remote keys: ${live ? `${live.size} read live from EAS` : `${remote.size} inferred from .env (run \`eas login\` for a live check)`}${RESET}\n`
  );

  if (!environment) {
    console.log(
      `  ${YELLOW}!${RESET} profile has no "environment" — EAS environment variables will NOT be injected\n`
    );
    totalFailures++;
  }

  let failures = 0;
  for (const key of [...used].sort()) {
    const sources = [];
    if (inline.has(key)) sources.push("eas.json");
    if (remote.has(key)) sources.push(`EAS:${environment}`);

    if (sources.length) {
      console.log(`  ${GREEN}✓${RESET} ${key.padEnd(42)} ${DIM}${sources.join(" + ")}${RESET}`);
      continue;
    }
    if (ALIASES[key] && (inline.has(ALIASES[key]) || remote.has(ALIASES[key]))) {
      console.log(
        `  ${GREEN}✓${RESET} ${key.padEnd(42)} ${DIM}falls back to ${ALIASES[key]}${RESET}`
      );
      continue;
    }
    if (OPTIONAL[key]) {
      console.log(`  ${YELLOW}~${RESET} ${key.padEnd(42)} ${DIM}${OPTIONAL[key]}${RESET}`);
      continue;
    }
    console.log(`  ${RED}✗${RESET} ${key.padEnd(42)} ${RED}MISSING — the build will read undefined${RESET}`);
    failures++;
  }

  console.log(
    failures
      ? `\n  ${RED}${failures} required key(s) missing for "${profile}".${RESET} Fix with: ${BOLD}npm run eas:env:push${RESET}`
      : `\n  ${GREEN}All required keys available for "${profile}".${RESET}`
  );
  totalFailures += failures;
}

console.log("");
process.exit(totalFailures ? 1 : 0);
