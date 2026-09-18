// Author authentication for /api/admin/*.
//
// Production: Cloudflare Access sits in front of /editor and /api/admin/*,
// and we verify the Cf-Access-Jwt-Assertion JWT (signature via the team's
// JWKS + aud claim). See README for Access setup.
//
// Local dev (wrangler dev without Access): allow through when no ACCESS_TEAM
// is configured so the editor is usable locally.

import { runtimeEnv } from "./env";

interface JwtPayload {
  aud: string[];
  email: string;
  exp: number;
  iss: string;
}

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function b64urlToJson(b64: string): unknown {
  const b64url = b64.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64url);
  const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function splitJwt(jwt: string): { header: { alg: string; kid?: string }; payload: JwtPayload; signature: ArrayBuffer } {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) throw new Error("malformed jwt");
  const sigBytes = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const signature = sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer;
  return {
    header: b64urlToJson(h) as { alg: string; kid?: string },
    payload: b64urlToJson(p) as JwtPayload,
    signature,
  };
}

async function fetchJwks(team: string): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_TTL_MS) {
    return cachedJwks.keys;
  }
  // Real Access teams are always https; loopback teams are the local-dev
  // JWKS mock (scripts/dev-access-token.mjs), which serves plain http.
  const scheme = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(team) ? "http" : "https";
  const res = await fetch(`${scheme}://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: JsonWebKey[] };
  cachedJwks = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function verifyAccessJwt(jwt: string, team: string, aud: string): Promise<JwtPayload> {
  const { header, payload, signature } = splitJwt(jwt);
  if (payload.iss !== `https://${team}`) throw new Error("bad issuer");
  if (!payload.aud?.includes(aud)) throw new Error("bad audience");
  if (payload.exp * 1000 < Date.now()) throw new Error("token expired");

  const keys = await fetchJwks(team);
  const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error("no matching jwk");

  const [h, p] = jwt.split(".");
  const data = new TextEncoder().encode(`${h}.${p}`);
  const ok = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    signature,
    data,
  );
  if (!ok) throw new Error("bad signature");
  return payload;
}

export const AUTH_DISABLED_LOCALLY = !runtimeEnv.ACCESS_TEAM || !runtimeEnv.ACCESS_AUD;

/** Returns true when the request may use admin APIs. */
export async function isAdmin(accessJwt: string | null): Promise<boolean> {
  if (AUTH_DISABLED_LOCALLY) return true; // local dev bypass: no Access configured
  if (!accessJwt) return false;
  try {
    await verifyAccessJwt(accessJwt, runtimeEnv.ACCESS_TEAM!, runtimeEnv.ACCESS_AUD!);
    return true;
  } catch {
    return false;
  }
}
