// Self-implemented OAuth 2.0 authorization-code flow for GitHub (admin
// editor login only — visitor comment identity is handled by giscus).
//
// Provider app you create yourself:
//   GitHub: Settings → Developer settings → OAuth Apps (callbacks
//           https://<origin>/api/auth/github/callback AND optionally
//           http://localhost:8787/api/auth/github/callback for local dev)
// Secrets: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET — activates when both exist.

import { runtimeEnv } from "./env";

export interface OAuthProvider {
  id: "github";
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
}

export function getProvider(): OAuthProvider | null {
  if (runtimeEnv.GITHUB_CLIENT_ID && runtimeEnv.GITHUB_CLIENT_SECRET) {
    return {
      id: "github",
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userUrl: "https://api.github.com/user",
      // read:user is enough for identity; user:email covers hidden-primary-email
      scope: "read:user user:email",
      clientId: runtimeEnv.GITHUB_CLIENT_ID,
      clientSecret: runtimeEnv.GITHUB_CLIENT_SECRET,
    };
  }
  return null;
}

export function githubEnabled(): boolean {
  return getProvider() !== null;
}

/** Only same-site absolute paths survive the ?next= round-trip. */
export function sanitizeNext(raw: string | null, fallback = "/editor/"): string {
  if (!raw) return fallback;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
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
    new TextEncoder().encode(`oauth:${runtimeEnv.AUTH_PASSWORD ?? "local-dev"}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export interface OAuthUser {
  email: string;
  name: string;
  login: string; // github username
  avatarUrl: string | null;
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
    avatar_url?: string | null;
  };
  if (!user.login) throw new Error("no github login in profile");

  let email = user.email;
  if (!email) {
    // GitHub hides email unless user:email granted — fetch primary.
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
    }
  }
  return {
    email: (email ?? `${user.login}@users.noreply.github.com`).toLowerCase(),
    name: user.name ?? user.login,
    login: user.login,
    avatarUrl: user.avatar_url ?? null,
  };
}
