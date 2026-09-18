// LOCAL DEV ONLY — mint a self-signed Access-shaped JWT + serve its JWKS.
//
// Problem: Cloudflare Access is an edge service; `wrangler dev` never sees
// the real login page, so verifyAccessJwt() in lib/auth.ts could never be
// exercised with a VALID token locally. This script closes that gap:
//
//   1. Generate an RSA keypair (same shape as Cloudflare's Access certs).
//   2. Start a tiny JWKS server on :8788 answering /cdn-cgi/access/certs
//      (the exact path fetchJwks() requests).
//   3. Print a signed Cf-Access-Jwt-Assertion for ACCESS_TEAM/AUD from .dev.vars.
//   4. Run wrangler dev against it, hit /api/admin/notes with the token.
//
// Usage:
//   node scripts/dev-access-token.mjs          # prints token, JWKS on :8788
//   curl -H "Cf-Access-Jwt-Assertion: $TOKEN" http://127.0.0.1:8787/api/admin/notes
//
// .dev.vars needs: ACCESS_TEAM=127.0.0.1:8788  ACCESS_AUD=<anything>

import { generateKeyPairSync, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";

const JWKS_PORT = 8788;

// --- read .dev.vars (same wrangler format) ---
const team = readDevVar("ACCESS_TEAM") ?? "127.0.0.1:8788";
const aud = readDevVar("ACCESS_AUD") ?? "dev-aud";

function readDevVar(name) {
  try {
    const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const m = vars.match(new RegExp(`^${name}=(.*)$`, "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// --- RSA keypair, Access JWKS shape ---
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const kid = "dev-key-1";
const jwks = { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] };

// --- mint the JWT (header/payload/signature, RS256 like real Access) ---
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const header = { alg: "RS256", kid, typ: "JWT" };
const now = Math.floor(Date.now() / 1000);
const payload = {
  aud: [aud],
  email: "dev@localhost",
  exp: now + 3600,
  iat: now,
  iss: `https://${team}`,
  sub: "dev-user",
};
const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
const jwt = `${signingInput}.${b64url(signature)}`;

// --- JWKS server on the exact path lib/auth.ts fetches ---
const server = http.createServer((req, res) => {
  if (req.url === "/cdn-cgi/access/certs") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(jwks));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(JWKS_PORT, "127.0.0.1", () => {
  console.log(`JWKS server:  http://127.0.0.1:${JWKS_PORT}/cdn-cgi/access/certs`);
  console.log(`.dev.vars needs:  ACCESS_TEAM=127.0.0.1:${JWKS_PORT}   ACCESS_AUD=${aud}`);
  console.log(`\nCf-Access-Jwt-Assertion (valid 1h):\n\n${jwt}\n`);
  console.log("Test:");
  console.log(`  curl -H "Cf-Access-Jwt-Assertion: <token>" http://127.0.0.1:8787/api/admin/notes`);
  console.log("\nCtrl+C to stop.");
});
