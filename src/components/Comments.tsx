import { useState, useEffect } from "react";

// Public comments island. Rendered on BOTH static /posts pages and the
// dynamic /notes SSR page, always loading approved comments via the public
// API — so moderating a comment never requires a site rebuild.
//
// Turnstile: when a TURNSTILE_SITE_KEY data attribute is present on the
// island's host element, the widget renders; local dev without a site key
// skips it (the Worker secret is unset too, so verification passes).
export default function Comments({ contentId }: { contentId: string }) {
  const [comments, setComments] = useState<Array<{ id: number; author_name: string; body: string; created_at: string }> | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [siteKey, setSiteKey] = useState<string | undefined>(undefined);

  // Read the Turnstile site key from the island's dataset once mounted
  // (client-only; document doesn't exist during prerender).
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-turnstile-key]");
    setSiteKey(el?.dataset.turnstileKey || undefined);
  }, []);

  useEffect(() => {
    fetch(`/api/public/comments?contentId=${encodeURIComponent(contentId)}`)
      .then((r) => r.json())
      .then((d) => setComments((d as { comments: typeof comments }).comments ?? []))
      .catch(() => setComments([]));
  }, [contentId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setState("sending");
    setErrorMsg("");
    let turnstileToken: string | undefined;
    const widget = document.querySelector<HTMLDivElement>(".cf-turnstile");
    if (widget) {
      turnstileToken = (window as unknown as { turnstile?: { getResponse: (el?: HTMLElement) => string } }).turnstile?.getResponse?.(widget) ?? undefined;
    }
    const res = await fetch("/api/public/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId, name, body, turnstileToken }),
    });
    if (res.ok) {
      setState("sent");
      setBody("");
    } else {
      const err = await res.json().catch(() => ({}));
      setErrorMsg((err as { error?: string }).error ?? "failed to send");
      setState("error");
    }
  }

  return (
    <section style={{ marginTop: "3rem" }}>
      <h2 style={{ fontSize: "1.2rem" }}>Comments</h2>

      {comments === null ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading…</p>
      ) : comments.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No comments yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {comments.map((c) => (
            <li key={c.id} style={{ padding: "0.7rem 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {c.author_name || "anonymous"}
                <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.6rem", fontSize: "0.8rem" }}>
                  {c.created_at.slice(0, 10)}
                </span>
              </div>
              {/* body is stored as PLAIN TEXT and React escapes it on render */}
              <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      {state === "sent" ? (
        <p style={{ background: "var(--accent-soft)", padding: "0.6rem 0.9rem", borderRadius: 8, fontSize: "0.9rem" }}>
          Thanks — your comment is awaiting moderation.
        </p>
      ) : (
        <form onSubmit={submit}>
          {siteKey && <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            maxLength={80}
            style={{ display: "block", width: "100%", font: "inherit", padding: "0.45rem 0.7rem", border: "1px solid var(--border)", borderRadius: 6, marginBottom: "0.5rem" }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            maxLength={5000}
            rows={3}
            required
            style={{ display: "block", width: "100%", font: "inherit", padding: "0.45rem 0.7rem", border: "1px solid var(--border)", borderRadius: 6, marginBottom: "0.5rem", resize: "vertical" }}
          />
          {state === "error" && <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{errorMsg}</p>}
          <button disabled={state === "sending"} style={{ font: "inherit" }}>
            {state === "sending" ? "Sending…" : "Submit"}
          </button>
        </form>
      )}
    </section>
  );
}
