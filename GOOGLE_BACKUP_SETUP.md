# Google Drive backup — setup

Trips live only in on-device SQLite (`services/db/trips.ts`). A wiped or lost
phone loses every itinerary the user ever generated. This feature is the
recovery path: one JSON document written to the user's **own** Google Drive,
on demand, from the Profile screen.

Nothing here is required for the app to run. With the OAuth client id absent,
the backup card hides itself and the rest of the app behaves exactly as before.

---

## What it does

| | |
|---|---|
| Where the backup lives | The user's Google Drive, in the hidden `appDataFolder` |
| File | `avent-trips-backup.json` (overwritten each time) |
| Scope requested | `https://www.googleapis.com/auth/drive.appdata` only |
| Trigger | Manual — **Back up now** / **Restore** on Profile |
| Restore behaviour | Merge, newest `updated_at` wins, **never deletes** |

`drive.appdata` is the narrowest Drive scope Google offers. It grants access to
a hidden per-app folder and to nothing else — the app cannot see, list or read
one single file the user owns. It is **not** a restricted scope, so it needs no
Google verification review and no privacy-policy submission. The user removes
the data from their Google Account → *Data & privacy* → *Third-party apps* →
Avent → *Delete all data*.

No new npm dependency was added: the OAuth flow runs on `expo-web-browser`
(already installed) and a hand-rolled PKCE helper (`utils/pkce.ts`), so existing
dev builds and APKs do not need a native rebuild for the *code*. You do need one
rebuild to register the redirect scheme in step 3.

---

## 1. Enable the Drive API

<https://console.cloud.google.com> → pick the same project your Firebase app
uses → **APIs & Services → Library** → search "Google Drive API" → **Enable**.

Without this every upload fails with HTTP 403 and the message
"Google Drive API has not been used in project … before or it is disabled".

## 2. Create the OAuth client ids

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

If the console asks you to configure the consent screen first: user type
**External**, add your email as a test user, and add the scope
`.../auth/drive.appdata`. Publishing status can stay **Testing** while you
develop — only the accounts listed as test users can connect until you publish.

### Android

- Application type: **Android**
- Package name: `com.Tripplanner.company`
- SHA-1 certificate fingerprint: the fingerprint of the key that signs the
  build you will install. For an EAS build:

  ```bash
  eas credentials -p android      # → Keystore → shows SHA1
  ```

  A debug build signed locally uses a different key, so add that SHA-1 as a
  **second** Android OAuth client if you want backup to work in a local debug
  build too.

### iOS (only if you ship iOS)

- Application type: **iOS**
- Bundle ID: `com.Tripplanner.company`

Copy each client id — they look like
`123456789012-abcdefghijklmnop.apps.googleusercontent.com`.

## 3. Register the redirect scheme in `app.json`

Google only accepts the *reversed* client id as the redirect scheme for native
OAuth clients. Take everything before `.apps.googleusercontent.com` and prefix
it with `com.googleusercontent.apps.`:

```
client id  123456789012-abcdefghijklmnop.apps.googleusercontent.com
scheme     com.googleusercontent.apps.123456789012-abcdefghijklmnop
```

Add it to `expo.scheme` (already an array for this reason):

```json
"scheme": [
  "myapp",
  "com.googleusercontent.apps.123456789012-abcdefghijklmnop"
],
```

If you have both an Android and an iOS client, add both schemes.

**This step needs a rebuild** (`eas build` / `npx expo prebuild`) because URL
schemes live in the native manifest. Skipping it makes the consent screen open
and then hang — so the app checks for it and refuses with a message naming the
exact scheme instead.

## 4. Put the client ids in the environment

`.env` for local dev:

```
EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID=
```

Then push them to EAS, or the APK will have `undefined` instead:

```bash
npm run eas:env          # dry run — shows what would be pushed
npm run eas:env:push
npm run check:build-env  # confirms nothing is missing before you build
```

## 5. Build and test

```bash
npm run build:apk
```

Expo Go **cannot** be used for this flow — it does not own the custom URL
scheme, so the redirect never returns. The app detects Expo Go and says so
rather than hanging.

On the device: **Profile → Backup → Connect Google** → pick an account → then
**Back up now**. Verify from the same Google account at
<https://drive.google.com/drive/settings> → *Manage apps*, where Avent should
now appear with hidden app data.

---

## How restore resolves conflicts

`importTripRows()` compares `updated_at` per `doc_id`:

- trip not on this device → **added**
- backup copy is newer → **updated**
- local copy is same age or newer → **skipped**
- row missing `doc_id` / `trip_plan` / `trip_data` → **invalid**, ignored

Nothing is ever deleted. Restoring a six-month-old backup onto a phone with
fresh trips is a normal mistake for a user to make, and it must not destroy the
newer data — which is exactly what a "wipe local, then insert" restore would do.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Card missing from Profile | No client id for this platform in the build. Check `npm run check:build-env`. |
| "app.json does not register the redirect scheme …" | Step 3 not done, or done without rebuilding. |
| Consent screen opens, then nothing happens | Running in Expo Go, or the scheme in `app.json` doesn't match the client id in `.env`. |
| `Error 400: redirect_uri_mismatch` | The client id in `.env` belongs to a *Web* OAuth client. It must be Android or iOS. |
| "Google Drive API has not been used…" (403) | Step 1 not done. |
| Works in an EAS build, fails in a local debug build | Different signing key → different SHA-1. Add a second Android OAuth client for the debug key. |
| "Access blocked: Avent has not completed the Google verification process" | Consent screen is in Testing and this account isn't a test user. Add it, or publish the app. |

## Files

```
utils/pkce.ts                    SHA-256 + base64url + PKCE pair (no native deps)
services/backup/googleAuth.ts    OAuth: consent, code exchange, refresh, revoke
services/backup/googleDrive.ts   Drive v3 client, appDataFolder only
services/backup/index.ts         Payload format, backupNow(), restoreFromBackup()
services/db/trips.ts             exportTripRows() / importTripRows()
components/GoogleBackupCard.tsx  The Profile card
```
