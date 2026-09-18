// Server-side Turnstile verification (https://developers.cloudflare.com/turnstile/).
// TURNSTILE_SECRET unset (local dev) → skip the check so the flow is testable.
import { runtimeEnv } from "./env";

export async function verifyTurnstile(token: string | undefined, ip: string | undefined): Promise<boolean> {
  const secret = runtimeEnv.TURNSTILE_SECRET;
  if (!secret) return true; // local dev bypass
  if (!token) return false;

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}
