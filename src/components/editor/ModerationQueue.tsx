import { useState, useEffect } from "react";

interface Comment {
  id: number;
  content_id: string;
  author_name: string;
  body: string;
  status: string;
  created_at: string;
}

export default function ModerationQueue() {
  const [comments, setComments] = useState<Comment[] | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/comments");
    if (res.ok) {
      const data = (await res.json()) as { comments?: Comment[] };
      setComments(data.comments ?? []);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function moderate(id: number, action: "approve" | "reject") {
    await fetch(`/api/admin/comments/${id}/moderate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    refresh();
  }

  if (comments === null) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  const pending = comments.filter((c) => c.status === "pending");
  const decided = comments.filter((c) => c.status !== "pending");

  return (
    <div>
      <h1 style={{ fontSize: "1.4rem" }}>Comments</h1>

      <h2 style={{ fontSize: "1.05rem" }}>Pending ({pending.length})</h2>
      {pending.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>Nothing awaiting moderation.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {pending.map((c) => (
            <li key={c.id} style={{ padding: "0.8rem 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                {c.author_name || "anonymous"} · on {c.content_id} · {c.created_at.slice(0, 16).replace("T", " ")}
              </div>
              <div style={{ whiteSpace: "pre-wrap", margin: "0.3rem 0" }}>{c.body}</div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => moderate(c.id, "approve")}>Approve</button>
                <button onClick={() => moderate(c.id, "reject")} style={{ color: "var(--danger)" }}>
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "2rem" }}>Decided ({decided.length})</h2>
      <ul style={{ listStyle: "none", padding: 0, color: "var(--text-muted)", fontSize: "0.85rem" }}>
        {decided.slice(0, 50).map((c) => (
          <li key={c.id} style={{ padding: "0.4rem 0" }}>
            [{c.status}] {c.author_name || "anonymous"} on {c.content_id}: {c.body.slice(0, 80)}
          </li>
        ))}
      </ul>
    </div>
  );
}
