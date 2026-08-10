import "react-native-get-random-values";

/**
 * PKCE primitives for the Google OAuth flow.
 *
 * Deliberately dependency-free. The obvious alternative is
 * `expo-crypto` + `expo-auth-session`, but both ship native code, so adding
 * them would force every existing dev/EAS build to be rebuilt before backup
 * works at all. SHA-256 over a 43-128 character ASCII verifier is a few dozen
 * lines and runs in well under a millisecond in Hermes, so paying for it in JS
 * is cheaper than paying for it in a release cycle.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** FIPS 180-4 SHA-256. Returns the 32 raw digest bytes. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  const len = bytes.length;
  // Smallest multiple of 64 that fits the message + the 0x80 marker + the
  // 8-byte length. Using a larger block would still satisfy the congruence but
  // would produce a different (wrong) digest, so the minimum matters here.
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;

  const view = new DataView(buf.buffer);
  const bitLen = len * 8;
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < total; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return out;
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 of raw bytes. Hand-rolled: React Native has no Buffer. */
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    // Length-driven rather than `undefined`-driven: indexing a Uint8Array is
    // typed as number, so an === undefined check would not even compile.
    const remaining = bytes.length - i;
    const b0 = bytes[i];
    const b1 = remaining > 1 ? bytes[i + 1] : 0;
    const b2 = remaining > 2 ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += remaining > 1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += remaining > 2 ? B64[b2 & 63] : "=";
  }
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url decode to a UTF-8 string. Used to read the id_token payload. */
export function base64UrlDecodeToString(input: string): string {
  const normalised = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of padded) {
    if (char === "=") break;
    const index = B64.indexOf(char);
    if (index === -1) continue;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  // Minimal UTF-8 decode — enough for the ASCII/UTF-8 JSON Google returns.
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[++i] & 0x3f));
    } else {
      out += String.fromCharCode(
        ((byte & 0x0f) << 12) |
          ((bytes[++i] & 0x3f) << 6) |
          (bytes[++i] & 0x3f)
      );
    }
  }
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = (globalThis as any).crypto;
  if (webCrypto?.getRandomValues) {
    // react-native-get-random-values (already a dependency) installs this.
    webCrypto.getRandomValues(bytes);
    return bytes;
  }
  // Math.random is not a CSPRNG. Reaching here means the polyfill failed to
  // load, and a guessable verifier defeats the point of PKCE, so refuse
  // rather than silently downgrading the flow's security.
  throw new Error(
    "No secure random source available — react-native-get-random-values did not install crypto.getRandomValues."
  );
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** RFC 7636 S256 pair: a 43-char verifier and its base64url SHA-256 challenge. */
export function createPkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(
    sha256(new Uint8Array(codeVerifier.split("").map((c) => c.charCodeAt(0))))
  );
  return { codeVerifier, codeChallenge };
}

/** Opaque value echoed back on the redirect, to reject unsolicited callbacks. */
export function createStateToken(): string {
  return base64UrlEncode(randomBytes(16));
}
