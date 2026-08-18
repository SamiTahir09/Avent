# Email verification, password reset, and Google Drive backup

Three features, one document, because they share one decision: **Firebase holds
accounts, SQLite holds data, and Google Drive holds a copy of that SQLite file
for every signed-in user.** Nothing was moved to Firestore to make this work.

| Thing | Where it lives | Free tier | Premium |
| --- | --- | --- | --- |
| Account, password, email verification | Firebase Auth | ✅ | ✅ |
| Password reset | Firebase Auth | ✅ | ✅ |
| Trips, caches, counters, analytics queue | SQLite (`avent.db`) | ✅ | ✅ |
| Entitlement (`premium`, purchase token) | Firestore `Users/{uid}` | ✅ | ✅ |
| Backup of `avent.db` | User's own Google Drive | ✅ | ✅ |

Firebase Auth's free Spark plan covers verification and reset emails — no Blaze
upgrade, no Cloud Function, no email provider.

---

## 1. Install the four new packages

```bash
npx expo install expo-auth-session expo-crypto expo-file-system expo-secure-store
```

Use `npx expo install`, not `npm install` — it picks the versions that match Expo
SDK 54. What each one is for:

| Package | Why |
| --- | --- |
| `expo-auth-session` | The Google OAuth (PKCE) flow for Drive |
| `expo-crypto` | PKCE code challenge hashing (peer of the above) |
| `expo-file-system` | Streams the database file to/from Drive without loading it into JS memory |
| `expo-secure-store` | Keychain / Android Keystore storage for the Drive refresh token |

Then:

```bash
npm run typecheck
```

---

## 2. Email verification — what to do in the Firebase console

The code is already wired. The console side is one optional step and one thing to
check.

1. **Authentication → Sign-in method** — Email/Password must be enabled (it
   already is, or sign-up would never have worked).
2. **Authentication → Templates → Email address verification** — optional. Edit
   the subject and body so the mail reads like Avent instead of a default
   Firebase notice. You can also set a reply-to address here. Do the same for
   **Password reset**.
3. **Authentication → Settings → Authorized domains** — leave
   `<project>.firebaseapp.com` in the list. That is the domain the verification
   link points at; removing it breaks every link.

Mail arrives from `noreply@<project>.firebaseapp.com`. It lands in spam more often
than you'd like, which is why the verify screen says so out loud.

### How the flow actually behaves

```
Sign up  →  Firebase account created  →  verification mail sent
         →  /(auth)/verify-email  (polls every 4s, resend on a 60s cooldown)
         →  user opens the link  →  screen unlocks itself  →  /(tabs)/mytrip
```

Firebase has no way to hold a signup open until the link is clicked — the auth
record must exist before there is anyone to email. So the account is created
immediately and the *gate is on entry to the app*, in three places:

- `app/index.tsx` — cold start
- `app/(tabs)/_layout.tsx` — every route into the tab group
- `app/(auth)/sign-in.tsx` — correct password + unverified email goes to the
  verify screen, not into the app

An unverified account therefore exists in Firebase but can do nothing. To clean
those up, filter `Authentication → Users` by unverified and delete periodically,
or add a scheduled Cloud Function later if it ever becomes a real volume problem.

---

## 3. Google Drive backup — Google Cloud setup

Do this in the **same Google Cloud project as your Firebase app** (a Firebase
project *is* a Cloud project), so the OAuth consent screen and the Drive API
belong to the same app identity.

### 3a. Enable the Drive API

<https://console.cloud.google.com/apis/library/drive.googleapis.com> → **Enable**.

### 3b. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**

- User type: External
- App name, support email, developer email: fill in
- **Scopes**: add `https://www.googleapis.com/auth/drive.appdata`, plus
  `openid` and `.../auth/userinfo.email`

`drive.appdata` is not a restricted scope — it grants access to a hidden folder
that only this app can see, and cannot read anything else in the user's Drive. It
does **not** require Google's security review, which `drive` or
`drive.file` would.

While the app is in *Testing*, add each tester under **Test users** or their
consent will be refused. Publish the app when you ship.

### 3c. Create the OAuth client IDs

**APIs & Services → Credentials → Create credentials → OAuth client ID**

**Android:**
- Application type: Android
- Package name: `com.Tripplanner.company`
- SHA-1: from `eas credentials` → Android → your build profile. Add the debug
  keystore's SHA-1 too if you want this to work in a local dev build.

**iOS** (only if you ship iOS):
- Application type: iOS
- Bundle ID: your iOS bundle identifier

There is **no client secret** for either. Mobile apps are public OAuth clients;
PKCE is what proves the token exchange came from this app.

### 3d. Put the client IDs in `.env`

```env
EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID=
```

Then push them to EAS, or the APK will have no backup feature even though your
local dev build does:

```bash
npm run eas:env:push
npm run check:build-env
```

### 3e. ⚠️ Register the redirect scheme in `app.json`

**This is the step that silently breaks the feature if you skip it.** Google
hands the authorization code back on a custom URI scheme equal to the *reversed*
client ID. Android and iOS only listen for schemes declared at build time.

`app.json` currently contains a placeholder:

```json
"scheme": [
  "myapp",
  "com.googleusercontent.apps.REPLACE-WITH-YOUR-ANDROID-CLIENT-ID"
],
```

Replace it with the reverse of your Android client ID — drop
`.apps.googleusercontent.com` and prefix `com.googleusercontent.apps.`:

```
client ID:  123456789-abcdefg.apps.googleusercontent.com
scheme:     com.googleusercontent.apps.123456789-abcdefg
```

If you also ship iOS, add the iOS client's reversed ID as a third entry.

Then rebuild — a scheme change is a native change, so Expo Go and an old dev
client won't pick it up:

```bash
npx expo prebuild --clean   # if you use the bare workflow
eas build -p android --profile preview
```

**Drive backup needs a dev build or an EAS build. It cannot work in Expo Go**,
which has no way to register a custom scheme.

---

## 4. How the backup works

### Files

| File | Role |
| --- | --- |
| `services/backup/googleAuth.ts` | OAuth: consent, refresh-token storage, token refresh, revoke |
| `services/backup/driveClient.ts` | Drive v3 REST against the hidden `appDataFolder` |
| `services/backup/driveBackup.ts` | Snapshot → upload; download → validate → swap in |
| `services/backup/autoBackup.ts` | The daily silent run and every reason it skips |
| `hooks/useDriveBackup.ts` | Screen state |
| `app/backup.tsx` | Backup & Restore screen, wrapped in `PremiumGate` |

### Backup

`VACUUM INTO` writes a compacted, consistent copy of `avent.db` — including the
WAL, which a plain file copy would miss along with the most recent trips. That
snapshot is streamed to Drive through a resumable upload session, so the database
never becomes a base64 string in JS memory. The same Drive file is replaced each
time, so an account holds exactly one backup. The snapshot is deleted afterwards.

### Restore

Download → `PRAGMA integrity_check` → confirm a `trips` table exists → confirm
the backup's schema version isn't newer than this build → **only then** close the
live database, delete it, and move the downloaded file into place. Reopening runs
migrations, so an older backup is upgraded on the way in. Everything before the
swap is reversible; a truncated download can't destroy local data.

### Automatic backup

`maybeAutoBackup()` runs on launch and whenever the app is backgrounded. It does
nothing unless *all* of: Drive connected, more than 24 h since the last backup,
online, and the connection is not metered. It never throws. The manual "Back up
now" button skips the metered check — an explicit tap is consent to spend mobile
data.

### Sign-out disconnects Drive

The Drive grant is stored per *device*. Leaving it after sign-out would let the
next person to sign in on that phone restore the previous user's trips.
`handleLogout` in `app/(tabs)/profile.tsx` revokes it. Reconnecting is one tap.

---

## 5. Testing checklist

**Auth**

- [ ] Sign up → mail arrives → verify screen unlocks by itself within ~4 s of
      clicking the link
- [ ] Resend is locked for 60 s and shows a countdown
- [ ] Force-quit while unverified, relaunch → back on the verify screen, not in
      the app
- [ ] Sign in with a correct password on an unverified account → verify screen
- [ ] Verify on a second device, return to the first, tap "I've verified" → in
- [ ] Forgot password → mail arrives → new password works
- [ ] A non-existent email on the forgot-password screen shows the same success
      message (no account enumeration)
- [ ] Change Password (Profile → Change Password) sends the reset mail to the
      signed-in user's own address

**Backup**

- [ ] Connect Google Drive → consent screen → returns to the app
- [ ] "Back up now" reports a size; a second run replaces rather than duplicates
      (check `drive.google.com` → Settings → Manage apps → Avent shows one
      hidden app data file)
- [ ] Uninstall, reinstall, sign in, restore → trips are back
- [ ] Restore with no backup present → "There's no backup in your Google Drive
      yet", nothing destroyed
- [ ] Airplane mode → "No internet connection", nothing destroyed
- [ ] Revoke access at <https://myaccount.google.com/permissions> → next backup
      says access was revoked and the screen returns to "Not connected"
- [ ] Sign out → screen returns to "Not connected"

---

## 6. Troubleshooting

**"Google sign-in failed: invalid_request" / the browser opens and never returns**
The reversed client ID is missing from `app.json`'s `scheme`, or you're testing in
Expo Go, or you haven't rebuilt since editing `app.json`. See §3e.

**"Google didn't return a refresh token"**
Google withholds it when consent was already granted. Remove Avent at
<https://myaccount.google.com/permissions> and connect again.

**"Drive lookup failed (403)"**
The Drive API isn't enabled on the project, or the account isn't listed as a test
user while the consent screen is in Testing.

**Backup succeeds but the file isn't in the user's Drive**
Correct. `appDataFolder` is hidden by design. It shows under Drive → Settings →
Manage apps.

**"This backup was made by a newer version of Avent"**
The device is on an older build than the one that wrote the backup. Migrations
only run forwards; update the app, then restore.

**Verification mail never arrives**
Check spam first. Then Authentication → Settings → Authorized domains still
contains `<project>.firebaseapp.com`. Firebase also rate-limits per address —
the 60 s cooldown exists to stay under it.
