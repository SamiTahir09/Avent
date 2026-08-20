# Avent — Google Drive Backup: 403 `access_denied` ka mukammal fix

_Ye document aapke apne code (`services/backup/googleAuth.ts`, `.env`, `app.json`, `google-services.json`) parh kar likha gaya hai._

---

## 1. Aapke project mein jo cheezein main ne verify ki hain

| Cheez | Value jo aapke code mein hai | Status |
| --- | --- | --- |
| Android package name | `com.Tripplanner.company` (capital **T**) | ✅ `app.json` aur `google-services.json` dono mein same |
| Redirect scheme | `com.Tripplanner.company:/oauth2redirect` | ✅ `app.json` ke `scheme` array mein maujood (lowercase copy bhi) |
| Drive scope | `https://www.googleapis.com/auth/drive.appdata` | ✅ Ye **non-sensitive** scope hai — Google ki security review ki zaroorat NAHI |
| Android OAuth Client ID | `385181211292-rh7lknd3f7enj7mtdekkvkim4pv2bsjg.apps.googleusercontent.com` | ⚠️ Neeche point 2 parhein |
| iOS OAuth Client ID | khaali | ℹ️ Theek hai agar aap iOS ship nahi kar rahe |
| Firebase project | `avent-ab2ac`, project number `1017431764960` | ⚠️ **Client ID ke project se different hai** |

### ⚠️ Sab se ahem baat: aapke do alag Google Cloud project hain

- Firebase project ka number: **1017431764960** (`avent-ab2ac`)
- OAuth Client ID jo app use kar rahi hai wo shuru hota hai: **385181211292**-...

OAuth Client ID ka pehla hissa hamesha us **project ka number** hota hai jis mein wo client bana hua hai. Matlab:

> Aapki app jo client ID use kar rahi hai wo project **385181211292** ka hai, `avent-ab2ac` ka **nahi**.

Iska seedha nateeja: agar aap ne Drive API enable, consent screen configure, ya test user add Firebase project (`avent-ab2ac`) mein kiya hai, to **wo bekaar gaya** — Google project `385181211292` ki settings dekhta hai. Ye 403 ki sab se aam wajah hoti hai jab do project mix ho jayein.

---

## 2. 403 `access_denied` ka asal matlab

Aap ne kaha: "email select ho jati hai, phir 403 access denied". Ye exact behaviour hai jab:

> Consent screen ka **Publishing status = Testing** hai aur jo Gmail aap select kar rahe hain wo **Test users** ki list mein nahi hai.

Google account picker to dikhata hai (wo login ka hissa hai), lekin account choose karne ke baad hi decide karta hai ke ye user allowed hai ya nahi. Allowed na ho to:

```
Access blocked: Avent has not completed the Google verification process
Error 403: access_denied
```

Do aur possible (kam common) wajah:

- Client ID jis project ka hai, us project mein **consent screen configure hi nahi** hui.
- App **Internal** user type par set hai (sirf Google Workspace org ke users) aur aap normal `@gmail.com` se sign in kar rahe hain.

**Note:** `403` jo *baad mein* aata hai (backup chalane par, "Drive lookup failed (403)") wo alag masla hai — us ka matlab hota hai **Drive API us project mein enable nahi** hai.

---

## 3. Step-by-step fix (har step verify karne ke sath)

### Step 0 — Pehle sahi project kholein

Browser mein ye URL kholein (project number seedha URL mein chalta hai):

```
https://console.cloud.google.com/apis/credentials?project=385181211292
```

- Page khul gaya aur wahan `rh7lknd3f7enj...` wala Android client nazar aaya → **yehi sahi project hai, aage ke saare steps isi mein karein.**
- Page na khule / "permission denied" aaye → aap us project ke owner nahi. Us soorat mein **Step 0-B** karein.

**Step 0-B (recommended safai):** sab kuch Firebase project mein le aayein taake aage confusion na ho.

1. Kholein: `https://console.cloud.google.com/auth/clients?project=avent-ab2ac`
2. Neeche Step 4 ke mutabiq naya **Android** OAuth client banayein.
3. Naya client ID `.env` mein daal dein (Step 5).
4. Phir Steps 1–3 bhi `avent-ab2ac` mein hi karein.

> Neeche mein `?project=YOUR_PROJECT` likha hai — wahan wohi project daalein jo aap ne is step mein chuna (`385181211292` ya `avent-ab2ac`).

---

### Step 1 — Google Drive API enable karein

```
https://console.cloud.google.com/apis/library/drive.googleapis.com?project=YOUR_PROJECT
```

- Agar button **"Enable"** likha hai → click karein.
- Agar pehle se **"Manage"** / "API enabled" likha hai → ✅ ye step ho chuka hai.

**Verify:** `https://console.cloud.google.com/apis/dashboard?project=YOUR_PROJECT` → enabled APIs ki list mein "Google Drive API" hona chahiye.

---

### Step 2 — OAuth consent screen (ab iska naam "Google Auth Platform" hai)

```
https://console.cloud.google.com/auth/overview?project=YOUR_PROJECT
```

Left side mein ye sections milenge: **Overview, Branding, Audience, Clients, Data access, Verification center**.

#### 2a. Branding

`https://console.cloud.google.com/auth/branding?project=YOUR_PROJECT`

Ye fields bharein aur **Save** karein:

- **App name**: `Avent`
- **User support email**: `samitahir858@gmail.com`
- **Developer contact information → Email addresses**: `samitahir858@gmail.com`

Agar ye adhoora hai to Google consent screen draw karne se pehle hi request reject kar deta hai.

#### 2b. Audience — 🔴 **YEHI 403 KA ASAL FIX HAI**

`https://console.cloud.google.com/auth/audience?project=YOUR_PROJECT`

1. **User type = External** hona chahiye (Internal nahi).
2. **Publishing status** dekhein:
   - Agar **"Testing"** likha hai → neeche **Test users** section mein **`+ Add users`** click karein
   - `samitahir858@gmail.com` daalein
   - Jo bhi doosre Gmail account se aap test karte hain, wo bhi daalein (max 100)
   - **Save** karein

3. **Behtar option — app ko publish kar dein:** usi Audience page par **"Publish app"** button hai.
   - Aapki app sirf `drive.appdata` + `openid` + `email` maangti hai. `drive.appdata` **non-sensitive** scope hai, is liye publish karne par **koi verification review nahi** hota — status foran "In production" ho jata hai.
   - Publish karna 2 faide deta hai:
     - Kisi bhi Gmail se sign in chalega, test user list ki zaroorat khatam.
     - **Testing mode mein refresh token sirf 7 din baad expire ho jata hai** — jo backup feature ke liye tabahi hai (silently backup band ho jata hai). Production mein ye limit nahi hai.

> Aapki app `access_type=offline` ke sath refresh token store karti hai (`googleAuth.ts`), is liye 7-din wali limit aap ko zaroor lagti — publish karna hi sahi hal hai.

#### 2c. Data access (scopes)

`https://console.cloud.google.com/auth/scopes?project=YOUR_PROJECT`

**Add or remove scopes** click karein aur ye 3 add karein, phir **Update** → **Save**:

```
https://www.googleapis.com/auth/drive.appdata
openid
https://www.googleapis.com/auth/userinfo.email
```

(Filter box mein `drive.appdata` type karke dhoondein. Agar Drive API Step 1 mein enable na ki ho to ye scope list mein nazar hi nahi aayega.)

---

### Step 3 — Android OAuth client theek karein

`https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT`

Apne Android client par click karein aur ye 3 cheezein verify karein:

**(a) Package name — bilkul exact:**

```
com.Tripplanner.company
```

Capital **T** zaroori hai. Ye `app.json` aur `google-services.json` dono se match karta hai. Ek harf ka farq bhi `access_denied` / `redirect_uri_mismatch` de deta hai.

**(b) SHA-1 certificate fingerprint:**

Terminal mein apne project folder mein chalayein:

```bash
npx eas credentials
```

→ Android → apna build profile → **SHA-1 Fingerprint** copy karein → console mein paste karein → Save.

Local dev build (`npx expo run:android`) se test kar rahe hain to **debug keystore ka SHA-1 bhi** add karein:

```bash
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

(Ek client mein aap ek se zyada SHA-1 add kar sakte hain — dono add kar dein.)

**(c) 🔴 "Enable Custom URI scheme" ON karein:**

Usi Android client page par **Advanced Settings** expand karein → **Enable Custom URI scheme** toggle ON → **Save**.

October 2023 se Google ne Android clients ke liye custom URI schemes **default par band** kar diye hain. Aapka pura flow (`com.Tripplanner.company:/oauth2redirect`) custom scheme hi hai — toggle band ho to Google consent screen dikhane se pehle hi request block kar deta hai.

> Ye change server-side hai — app rebuild karne ki zaroorat nahi, lekin propagate hone mein 5–10 minute lag sakte hain.

---

### Step 4 (agar naya client banaya) — Naya Android client banane ka tareeqa

`https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT` → **+ Create client**

- Application type: **Android**
- Name: `Avent Android`
- Package name: `com.Tripplanner.company`
- SHA-1: Step 3(b) se
- Create → phir usi client mein ja kar **Advanced Settings → Enable Custom URI scheme** ON karein

**Client secret nahi hota** Android client ka — ye normal hai. Aapka code PKCE use karta hai, secret ki zaroorat nahi.

---

### Step 5 — Client ID `.env` aur EAS mein daalein

`.env` (line 54):

```env
EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID=<naya-ya-purana-client-id>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID=
```

Phir EAS par push karein (warna APK mein backup feature hi nahi hoga):

```bash
npm run eas:env:push
npm run check:build-env
```

`check:build-env` output mein `EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID` ✅ dikhna chahiye.

---

### Step 6 — Purani grant hataayein, phir dobara try karein

1. Kholein: <https://myaccount.google.com/permissions>
2. **Avent** dhoondein → **Remove access** (agar list mein hai)
3. 5–10 minute intezar karein (console changes propagate hote hain)
4. App band karke dobara kholein → Backup screen → **Connect Google Drive**

Agar aap ne `app.json`, package name, ya SHA-1 change kiya hai to **rebuild** lazmi hai:

```bash
eas build -p android --profile preview
```

> ⚠️ **Expo Go mein ye kabhi kaam nahi karega** — Expo Go custom URI scheme register nahi kar sakta. Dev build ya EAS build lazmi hai.

---

## 4. Fatafat checklist (screen par tick karte jayein)

- [ ] Client ID `385181211292-...` — pata hai ye kis project ka hai, aur wohi project khula hua hai
- [ ] Google Drive API us project mein **enabled**
- [ ] Branding: app name + support email + developer email bhare hue
- [ ] Audience: user type **External**
- [ ] Audience: `samitahir858@gmail.com` **Test users** mein — **YA** app **Published (In production)**
- [ ] Data access: `drive.appdata` + `openid` + `userinfo.email` added
- [ ] Android client: package name `com.Tripplanner.company` (capital T)
- [ ] Android client: SHA-1 `eas credentials` wale se match karta hai
- [ ] Android client: **Enable Custom URI scheme = ON**
- [ ] `.env` mein sahi client ID + `npm run eas:env:push` chal gaya
- [ ] myaccount.google.com/permissions se purani Avent grant remove ki
- [ ] Dev/EAS build par test kiya (Expo Go par nahi)

---

## 5. Error ke hisaab se kya galat hai

| Screen par kya dikhta hai | Wajah | Kahan theek karein |
| --- | --- | --- |
| `Error 403: access_denied` — "app has not completed verification" | Testing mode + email test user nahi | Step 2b |
| `Error 400: redirect_uri_mismatch` / "Access blocked: request is invalid" | Package name galat, ya iOS-style reversed client ID use ho raha | Step 3(a) |
| "Access blocked" bina koi scope screen dikhne ke | Custom URI scheme toggle OFF | Step 3(c) |
| Browser tab consent ke baad wahin ruk jata hai | `app.json` ka `scheme` register nahi / rebuild nahi kiya | Step 6 |
| `Drive lookup failed (403)` — connect ke baad backup par | Drive API enable nahi | Step 1 |
| "Google didn't return a refresh token" | Consent pehle se granted tha | Step 6 (permissions se remove karein) |
| 7 din baad backup khud band ho gaya | App Testing mode mein hai | Step 2b → **Publish app** |
| "Google Drive backup isn't configured for this build" | `.env` / EAS mein client ID nahi | Step 5 |

---

## 6. Ek line ka jawab

> Google Cloud Console → us project mein jo client ID `385181211292-...` ka owner hai → **Google Auth Platform → Audience** → apna Gmail **Test users** mein add karein (ya seedha **Publish app** dabayein), aur **Clients → Android client → Advanced Settings → Enable Custom URI scheme = ON** karein. 403 khatam.
