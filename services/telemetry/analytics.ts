import { getDb, getMeta, setMeta } from "@/services/db";

import { AnalyticsEvent, type AnalyticsParams } from "./events";
import { getNativeAnalytics } from "./nativeFirebase";
import { isTelemetryEnabled, telemetryDebugLog } from "./config";

/**
 * Analytics facade.
 *
 * Every event is written to the SQLite `analytics_queue` table first and only
 * then handed to a backend. That ordering is deliberate: it makes the app the
 * durable buffer, so events survive being offline, a force-quit mid-flush, or
 * having no reporting backend configured at all — and it gives the Diagnostics
 * screen something concrete to show.
 *
 * Two backends, picked automatically:
 *
 *   1. @react-native-firebase/analytics when the native module is present
 *      (dev build / EAS build). Real Firebase Analytics, real DebugView.
 *   2. Otherwise the GA4 Measurement Protocol over plain `fetch`, which works
 *      in Expo Go. This needs an API secret, created once in
 *      GA4 Admin → Data Streams → your stream → Measurement Protocol API
 *      secrets, exposed as EXPO_PUBLIC_GA4_API_SECRET.
 *
 * With neither available the queue still fills up and events are logged to the
 * console in dev, so instrumentation can be verified before any backend exists.
 */

const CLIENT_ID_KEY = "analytics_client_id";
const MAX_QUEUE_ROWS = 500;

const MEASUREMENT_ID = process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID;
const API_SECRET = process.env.EXPO_PUBLIC_GA4_API_SECRET;

let cachedClientId: string | null = null;
let currentUserId: string | null = null;
let flushing = false;

// ─── Client id ─────────────────────────────────────────────────────────────

function randomId(): string {
  // GA4 only requires a stable opaque string; this avoids pulling in a uuid dep.
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}

async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;
  const stored = await getMeta(CLIENT_ID_KEY);
  if (stored) {
    cachedClientId = stored;
    return stored;
  }
  const created = randomId();
  await setMeta(CLIENT_ID_KEY, created);
  cachedClientId = created;
  return created;
}

// ─── Param hygiene ─────────────────────────────────────────────────────────

/**
 * GA4 rejects a whole payload if any param is malformed, so params are
 * normalised rather than passed through: nulls dropped, objects stringified,
 * keys and string values truncated to GA4's limits (40 / 100 chars).
 */
function sanitize(params?: AnalyticsParams): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;

  for (const [rawKey, rawValue] of Object.entries(params)) {
    if (rawValue === null || rawValue === undefined) continue;
    const key = rawKey.slice(0, 40);
    if (typeof rawValue === "number" || typeof rawValue === "boolean") {
      out[key] = rawValue;
    } else if (typeof rawValue === "string") {
      out[key] = rawValue.slice(0, 100);
    } else {
      out[key] = String(rawValue).slice(0, 100);
    }
  }
  return out;
}

// ─── Queue ─────────────────────────────────────────────────────────────────

async function enqueue(
  name: string,
  params: Record<string, string | number | boolean>
): Promise<number | null> {
  try {
    const db = await getDb();
    const result = await db.runAsync(
      "INSERT INTO analytics_queue (name, params, user_uid, created_at, sent) VALUES (?, ?, ?, ?, 0);",
      [name, JSON.stringify(params), currentUserId, Date.now()]
    );

    // Keep the table bounded by TOTAL rows, not just sent ones. In dev — and in
    // any build with no reporting backend configured — nothing is ever marked
    // sent, so pruning `WHERE sent = 1` would never delete anything and the
    // database would grow without limit.
    await db.runAsync(
      `DELETE FROM analytics_queue
        WHERE id NOT IN (SELECT id FROM analytics_queue ORDER BY id DESC LIMIT ?);`,
      [MAX_QUEUE_ROWS]
    );

    return result.lastInsertRowId;
  } catch (err) {
    telemetryDebugLog("failed to queue event", name, err);
    return null;
  }
}

/**
 * Guarded: `logEvent` is always called as `void logEvent(...)`, so a throw here
 * becomes an unhandled rejection — which the rejection tracker then turns into
 * another recordError, i.e. a reporting loop.
 */
async function markSent(ids: number[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await getDb();
    await db.runAsync(
      `UPDATE analytics_queue SET sent = 1 WHERE id IN (${ids.map(() => "?").join(",")});`,
      ids
    );
  } catch (err) {
    telemetryDebugLog("markSent failed", err);
  }
}

// ─── Backends ──────────────────────────────────────────────────────────────

async function sendViaNative(
  name: string,
  params: Record<string, string | number | boolean>
): Promise<boolean> {
  const native = getNativeAnalytics();
  if (!native) return false;
  try {
    // logEvent rejects GA4's reserved names, which have dedicated helpers.
    if (name === AnalyticsEvent.SCREEN_VIEW) {
      await native.logScreenView({
        screen_name: String(params.screen_name ?? "unknown"),
        screen_class: String(params.screen_class ?? params.screen_name ?? "unknown"),
      });
    } else {
      await native.logEvent(name, params);
    }
    return true;
  } catch (err) {
    telemetryDebugLog("native analytics logEvent failed", name, err);
    return false;
  }
}

// `/mp/collect` answers 204 even for a wrong measurement id or a bad api
// secret — GA4 silently discards the payload. So a one-off validation against
// the debug endpoint decides whether this backend is trusted at all; without it
// a misconfigured app would happily mark every event "delivered" while GA4
// received nothing, and Diagnostics would report 0 pending.
let mpValidated: boolean | null = null;

export function isMeasurementProtocolConfigured(): boolean {
  if (!MEASUREMENT_ID || !API_SECRET) return false;
  return mpValidated !== false;
}

/**
 * Validates the measurement id + api secret pair once and caches the verdict.
 * Called from initTelemetry so the result is known before the first flush.
 */
export async function ensureMeasurementProtocolValidated(): Promise<boolean> {
  if (!MEASUREMENT_ID || !API_SECRET) return false;
  if (mpValidated !== null) return mpValidated;
  const { ok } = await validateMeasurementProtocol();
  mpValidated = ok;
  if (!ok) {
    telemetryDebugLog(
      "GA4 Measurement Protocol rejected the test payload — treating it as unconfigured"
    );
  }
  return ok;
}

async function sendViaMeasurementProtocol(
  events: { name: string; params: Record<string, string | number | boolean> }[]
): Promise<boolean> {
  if (!isMeasurementProtocolConfigured() || !events.length) return false;

  try {
    const clientId = await getClientId();
    const body: Record<string, unknown> = {
      client_id: clientId,
      // GA4 drops events with no engagement signal from an unknown session,
      // so every batch carries a session id + engagement flag.
      events: events.map((event) => ({
        name: event.name,
        params: {
          ...event.params,
          session_id: clientId,
          engagement_time_msec: 100,
        },
      })),
    };
    if (currentUserId) body.user_id = currentUserId;

    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
        MEASUREMENT_ID!
      )}&api_secret=${encodeURIComponent(API_SECRET!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    // MP always answers 204 on success and never reports validation errors on
    // the production endpoint — use validateMeasurementProtocol() for those.
    return res.status === 204 || res.ok;
  } catch (err) {
    telemetryDebugLog("measurement protocol send failed", err);
    return false;
  }
}

/**
 * Hits GA4's debug endpoint, which *does* return validation messages. Used by
 * the diagnostics flow to prove the measurement id + api secret pair works.
 */
export async function validateMeasurementProtocol(): Promise<{
  ok: boolean;
  detail: string;
}> {
  if (!MEASUREMENT_ID) {
    return { ok: false, detail: "EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID not set" };
  }
  if (!API_SECRET) {
    return {
      ok: false,
      detail:
        "EXPO_PUBLIC_GA4_API_SECRET not set (GA4 Admin → Data Streams → Measurement Protocol API secrets)",
    };
  }

  try {
    const clientId = await getClientId();
    const res = await fetch(
      `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(
        MEASUREMENT_ID
      )}&api_secret=${encodeURIComponent(API_SECRET)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          events: [
            {
              name: AnalyticsEvent.TEST_EVENT,
              params: { engagement_time_msec: 100, session_id: clientId },
            },
          ],
        }),
      }
    );
    const json = await res.json().catch(() => ({}));
    const messages: any[] = json?.validationMessages ?? [];
    if (messages.length === 0) {
      return { ok: true, detail: "GA4 accepted the payload (0 validation messages)" };
    }
    return {
      ok: false,
      detail: messages
        .map((m) => `${m.validationCode ?? "?"}: ${m.description ?? ""}`)
        .join(" | "),
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function logEvent(
  name: string,
  params?: AnalyticsParams
): Promise<void> {
  const clean = sanitize(params);
  const id = await enqueue(name, clean);

  telemetryDebugLog(`event ${name}`, clean);

  if (!isTelemetryEnabled()) return;

  const sentNatively = await sendViaNative(name, clean);
  if (sentNatively) {
    if (id !== null) await markSent([id]);
    return;
  }

  const sentViaMp = await sendViaMeasurementProtocol([{ name, params: clean }]);
  if (sentViaMp && id !== null) await markSent([id]);
}

export async function logScreenView(
  screenName: string,
  screenClass?: string
): Promise<void> {
  await logEvent(AnalyticsEvent.SCREEN_VIEW, {
    screen_name: screenName,
    screen_class: screenClass ?? screenName,
  });
}

export async function setAnalyticsUserId(uid: string | null): Promise<void> {
  currentUserId = uid;
  const native = getNativeAnalytics();
  if (native) {
    try {
      await native.setUserId(uid);
    } catch (err) {
      telemetryDebugLog("setUserId failed", err);
    }
  }
}

export async function setAnalyticsUserProperties(
  properties: Record<string, string | null>
): Promise<void> {
  const native = getNativeAnalytics();
  if (!native) return;
  try {
    await native.setUserProperties(properties);
  } catch (err) {
    telemetryDebugLog("setUserProperties failed", err);
  }
}

/**
 * Retries anything the queue still holds. Called at app start and whenever
 * connectivity comes back, so an offline session's events aren't lost.
 */
export async function flushAnalyticsQueue(limit = 100): Promise<number> {
  if (flushing || !isTelemetryEnabled()) return 0;
  flushing = true;
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: number;
      name: string;
      params: string | null;
    }>(
      "SELECT id, name, params FROM analytics_queue WHERE sent = 0 ORDER BY id ASC LIMIT ?;",
      [limit]
    );
    if (!rows.length) return 0;

    const events = rows.map((row) => ({
      id: row.id,
      name: row.name,
      params: (() => {
        try {
          return JSON.parse(row.params ?? "{}");
        } catch {
          return {};
        }
      })(),
    }));

    const native = getNativeAnalytics();
    if (native) {
      const delivered: number[] = [];
      for (const event of events) {
        if (await sendViaNative(event.name, event.params)) delivered.push(event.id);
      }
      await markSent(delivered);
      return delivered.length;
    }

    // MP accepts up to 25 events per request.
    let delivered = 0;
    for (let i = 0; i < events.length; i += 25) {
      const batch = events.slice(i, i + 25);
      if (await sendViaMeasurementProtocol(batch)) {
        await markSent(batch.map((e) => e.id));
        delivered += batch.length;
      }
    }
    return delivered;
  } catch (err) {
    telemetryDebugLog("flush failed", err);
    return 0;
  } finally {
    flushing = false;
  }
}

export async function getQueuedEventCounts(): Promise<{
  pending: number;
  sent: number;
}> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ pending: number; sent: number }>(
      "SELECT SUM(sent = 0) AS pending, SUM(sent = 1) AS sent FROM analytics_queue;"
    );
    return { pending: row?.pending ?? 0, sent: row?.sent ?? 0 };
  } catch {
    return { pending: 0, sent: 0 };
  }
}

export async function getRecentEvents(limit = 20): Promise<
  { id: number; name: string; params: string | null; created_at: number; sent: number }[]
> {
  try {
    const db = await getDb();
    return await db.getAllAsync(
      "SELECT id, name, params, created_at, sent FROM analytics_queue ORDER BY id DESC LIMIT ?;",
      [limit]
    );
  } catch {
    return [];
  }
}
