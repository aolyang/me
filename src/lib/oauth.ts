// Self-implemented OAuth 2.0 authorization-code flow for GitHub and Google,
// running entirely in the Worker. No libraries, no Zero Trust.
//
// Provider apps you create yourself:
//   GitHub: Settings → Developer settings → OAuth Apps (callback
//           <origin>/api/auth/github/callback)
//   Google: console.cloud.google.com → Credentials → OAuth client
//           (callback <origin>/api/auth/google/callback)
// Secrets: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID/
//          GOOGLE_CLIENT_SECRET. Each provider activates only when both
//          its secrets exist.
//
// Allowed account: AUTHOR_EMAILS (comma-separated). Any other account is
// rejected with 403 — this is a single-author site, not open signup.

import { runtimeEnv } from "./env";

export interface OAuthProvider {
  id: "github" | "google";
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
}

export function getProvider(id: string): OAuthProvider | null {
  if (id === "github" && runtimeEnv.GITHUB_CLIENT_ID && runtimeEnv.GITHUB_CLIENT_SECRET) {
    return {
      id: "github",
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userUrl: "https://api.github.com/user",
      scope: "read:user user:email",
      clientId: runtimeEnv.GITHUB_CLIENT_ID,
      clientSecret: runtimeEnv.GITHUB_CLIENT_SECRET,
    };
  }
  if (id === "google" && runtimeEnv.GOOGLE_CLIENT_ID && runtimeEnv.GOOGLE_CLIENT_SECRET) {
    return {
      id: "google",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
      clientId: runtimeEnv.GOOGLE_CLIENT_ID,
      clientSecret: runtimeEnv.GOOGLE_CLIENT_SECRET,
    };
  }
  return null;
}

/** Which providers are configured (drives the login page buttons). */
export function oauthProviders(): Array<"github" | "google"> {
  const list: Array<"github" | "google"> = [];
  if (runtimeEnv.GITHUB_CLIENT_ID && runtimeEnv.GITHUB_CLIENT_SECRET) list.push("github");
  if (runtimeEnv.GOOGLE_CLIENT_ID && runtimeEnv.GOOGLE_CLIENT_SECRET) list.push("google");
  return list;
}

/** Only same-site absolute paths survive the ?next= round-trip. */
export function sanitizeNext(raw: string | null): string {
  if (!raw) return "/editor/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/editor/";
}

export function allowedEmails(): string[] {
  return (runtimeEnv.AUTHOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Unguessable state token binding this browser to the flow (CSRF). */
export function makeState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Signed state cookie so the callback can verify it came from us. */
export async function stateCookie(state: string): Promise<string> {
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(),
      new TextEncoder().encode(state),
    ),
  );
  const sigHex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return `me_oauth_state=${state}.${sigHex}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export async function verifyState(cookieHeader: string | null, state: string | null): Promise<boolean> {
  if (!state) return false;
  const m = cookieHeader?.match(/me_oauth_state=([0-9a-f]+)\.([0-9a-f]+)/);
  if (!m) return false;
  if (m[1] !== state) return false;
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(state)),
  );
  const expectedHex = Array.from(expected, (b) => b.toString(16).padStart(2, "0")).join("");
  return expectedHex === m[2];
}

async function hmacKey(): Promise<CryptoKey> {
  // Keyed by AUTH_PASSWORD when present; falls back to a constant (local dev).
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("oauth:" + (runtimeEnv.AUTH_PASSWORD ?? "local-dev")),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export interface OAuthUser {
  email: string;
  name: string;
}

/** Exchange the code + fetch the verified user identity. */
export async function exchangeCode(p: OAuthProvider, code: string, redirectUri: string): Promise<OAuthUser> {
  const tokenRes = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("no access_token in response");

  const userRes = await fetch(p.userUrl, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  if (!userRes.ok) throw new Error(`user fetch failed: ${userRes.status}`);
  const user = (await userRes.json()) as {
    email?: string | null;
    login?: string;
    name?: string | null;
  };

  let email = user.email;
  if (!email && p.id === "github") {
    // GitHub hides email unless user:email granted — fetch primary.
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
    }
  }
  if (!email) throw new Error("no email from provider");
  return { email: email.toLowerCase(), name: user.name ?? user.login ?? email };
}
