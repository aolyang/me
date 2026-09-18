import { useState, useEffect } from "react";

interface NoteSummary {
  id: string;
  title: string;
  slug: string | null;
  visibility: "draft" | "published" | "unpublished";
  draftRevision: number;
  publicRevision: number | null;
  updatedAt: string;
  publishedAt: string | null;
  job: { id: number; status: string; action: string; error: string | null } | null;
}

export default function NoteList() {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const anyFailed = (notes ?? []).some((n) => n.job?.status === "failed");

  async function refresh() {
    const res = await fetch("/api/admin/notes");
    if (res.ok) setNotes(await res.json());
  }

  useEffect(() => {
    refresh();
    // Auto-retry failed exports on editor load (single-user reconciliation).
    fetch("/api/admin/jobs/retry", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(refresh);
  }, []);

  async function retryAll() {
    await fetch("/api/admin/jobs/retry", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    refresh();
  }

  async function createNote() {
    setCreating(true);
    const res = await fetch("/api/admin/notes", { method: "POST" });
    setCreating(false);
    if (res.ok) {
      const note = (await res.json()) as { id: string };
      location.href = `/editor/${note.id}`;
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0 }}>Notes</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {anyFailed && <button onClick={retryAll}>Retry failed exports</button>}
          <button onClick={createNote} disabled={creating}>
            + New note
          </button>
          <button onClick={logout} title="Sign out">
            ⎋
          </button>
        </div>
      </div>

      {notes === null ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>
          No notes yet. Create one — it saves automatically as you type.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {notes.map((n) => (
            <li key={n.id} style={{ padding: "0.7rem 0", borderBottom: "1px solid var(--border)" }}>
              <a href={`/editor/${n.id}`} style={{ fontWeight: 600 }}>
                {n.title || "(untitled)"}
              </a>
              <span className="badge">{n.visibility}</span>
              {n.job && n.job.status === "failed" && (
                <span className="badge" style={{ color: "var(--danger)" }}>export failed</span>
              )}
              {n.visibility === "published" && n.publicRevision === n.draftRevision - 1 && (
                <span className="badge">unsaved edits</span>
              )}
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                updated {n.updatedAt.slice(0, 16).replace("T", " ")} · rev {n.draftRevision}
                {n.slug && <> · /posts/{n.slug}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
