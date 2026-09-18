// Author authentication for /api/admin/* and /editor — single password +
// HMAC-signed session cookie.
//
// Production: set the AUTH_PASSWORD worker secret. Login (POST /api/auth/login)
// issues a 30-day signed cookie (me_auth=<exp>.<hmac>); the HMAC key is
// derived from the password, so rotating AUTH_PASSWORD logs out every device.
//
// Local dev (wrangler dev without AUTH_PASSWORD): allow through so the
// editor is usable locally.

import { runtimeEnv } from "./env";

const COOKIE_NAME = "me_auth";
const SESSION_TTL_S = 30 * 24 * 3600;

export const AUTH_DISABLED_LOCALLY = !runtimeEnv.AUTH_PASSWORD;

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

/** Session HMAC key, derived from the password (rotate password = kill sessions). */
async function sessionKey(): Promise<CryptoKey> {
  const material = await sha256("session:" + runtimeEnv.AUTH_PASSWORD);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Timing-safe password check: hash both sides to fixed length, then XOR-compare. */
export async function checkPassword(password: string): Promise<boolean> {
  const a = new Uint8Array(await sha256(password));
  const b = new Uint8Array(await sha256(runtimeEnv.AUTH_PASSWORD!));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createSessionCookie(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const payload = exp.toString(36);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await sessionKey(), new TextEncoder().encode(payload)),
  );
  return `${COOKIE_NAME}=${payload}.${toB64url(sig)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_S}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Returns true when the request (by Cookie header) may use admin surfaces. */
export async function isAdmin(cookieHeader: string | null): Promise<boolean> {
  if (AUTH_DISABLED_LOCALLY) return true;
  const m = cookieHeader?.match(new RegExp(`${COOKIE_NAME}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)`));
  if (!m) return false;
  const exp = parseInt(m[1], 36);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  return crypto.subtle.verify(
    "HMAC",
    await sessionKey(),
    fromB64url(m[2]),
    new TextEncoder().encode(m[1]),
  );
}
