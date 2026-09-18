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
    <section className="comments-section">
      <h2>评论</h2>

      {comments === null ? (
        <p style={{ color: "var(--text-faint)", fontSize: "0.9rem" }}>加载中…</p>
      ) : comments.length === 0 ? (
        <p style={{ color: "var(--text-faint)", fontSize: "0.9rem" }}>还没有评论。</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {comments.map((c) => (
            <li key={c.id} className="comment-item">
              <div className="who">
                {c.author_name || "匿名"}
                <span className="when">{c.created_at.slice(0, 10)}</span>
              </div>
              {/* body is stored as PLAIN TEXT and React escapes it on render */}
              <p className="body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {state === "sent" ? (
        <p style={{ background: "var(--bg-sunk)", padding: "0.6rem 0.9rem", borderRadius: "var(--radius)", fontSize: "0.9rem" }}>
          谢谢 — 你的评论等待审核中。
        </p>
      ) : (
        <form onSubmit={submit}>
          {siteKey && <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名字(可选)"
            maxLength={80}
            style={{ display: "block", width: "100%", marginBottom: "0.5rem" }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="写条评论…"
            maxLength={5000}
            rows={3}
            required
            style={{ display: "block", width: "100%", marginBottom: "0.5rem", resize: "vertical" }}
          />
          {state === "error" && <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{errorMsg}</p>}
          <button className="btn--primary" disabled={state === "sending"}>
            {state === "sending" ? "发送中…" : "提交"}
          </button>
        </form>
      )}
    </section>
  );
}
