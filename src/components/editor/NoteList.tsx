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
    fetch("/api/admin/jobs/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then(refresh);
  }, []);

  async function retryAll() {
    await fetch("/api/admin/jobs/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
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

  const VIS_LABEL: Record<NoteSummary["visibility"], string> = {
    draft: "草稿",
    published: "已发布",
    unpublished: "已下架",
  };

  return (
    <div>
      <div className="editor-topbar">
        <span className="crumb">笔记</span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {anyFailed && <button onClick={retryAll}>重试失败的导出</button>}
          <button className="btn--primary" onClick={createNote} disabled={creating}>
            + 新笔记
          </button>
          <button onClick={logout} title="退出登录">
            ⎋
          </button>
        </div>
      </div>

      {notes === null ? (
        <p style={{ color: "var(--text-faint)" }}>加载中…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: "var(--text-faint)" }}>
          还没有笔记。创建一条 — 输入即自动保存。
        </p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <div>
                <a className="note-title" href={`/editor/${n.id}`}>
                  {n.title || "(无标题)"}
                </a>{" "}
                <span
                  className={
                    "chip" + (n.visibility === "published" ? " chip--ok" : "")
                  }
                >
                  {VIS_LABEL[n.visibility]}
                </span>
                {n.job && n.job.status === "failed" && (
                  <span className="chip chip--danger">导出失败</span>
                )}
                {n.visibility === "published" && n.publicRevision === n.draftRevision - 1 && (
                  <span className="chip">有未发布的修改</span>
                )}
              </div>
              <div className="note-meta">
                {n.updatedAt.slice(0, 16).replace("T", " ")} · rev {n.draftRevision}
                {n.slug && ` · /posts/${n.slug}`}
              </div>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
