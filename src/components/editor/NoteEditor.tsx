import { useEffect, useState, useCallback, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { contentExtensions } from "../../content-extensions";

interface NoteRecord {
  id: string;
  title: string;
  slug: string | null;
  document: string;
  draft_revision: number;
  public_revision: number | null;
  visibility: "draft" | "published" | "unpublished";
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export default function NoteEditor({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<NoteRecord | null>(null);
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const revisionRef = useRef(1);
  const dirtyRef = useRef(false);

  const editor = useEditor({
    extensions: contentExtensions,
    content: { type: "doc", content: [] },
    editorProps: {
      attributes: {
        class: "prose",
        style: "outline:none;min-height:50vh",
      },
      // Paste/drop an image → upload to R2 → insert media:// node.
      // (Synchronous handlers; the async upload runs detached and inserts
      // when it resolves. Returning true only for image content.)
      handlePaste: (view, event) => {
        const hasImage = Array.from(event.clipboardData?.files ?? []).some((f) =>
          f.type.startsWith("image/"),
        );
        if (hasImage) void handleMediaInsert(event.clipboardData);
        return hasImage;
      },
      handleDrop: (view, event) => {
        const hasImage = Array.from(event.dataTransfer?.files ?? []).some((f) =>
          f.type.startsWith("image/"),
        );
        if (hasImage) {
          event.preventDefault();
          void handleMediaInsert(event.dataTransfer);
        }
        return hasImage;
      },
    },
    onUpdate: () => {
      dirtyRef.current = true;
      setSaveState("dirty");
    },
  });

  // Upload pasted/dropped images for this note and insert media:// nodes.
  async function handleMediaInsert(data: DataTransfer | null): Promise<void> {
    if (!data || !editor) return;
    const images = Array.from(data.files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    for (const file of images) {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(`/api/admin/notes/${noteId}/images`, { method: "POST", body: form });
        if (!res.ok) {
          setMessage(`Image upload failed (${res.status}).`);
          continue;
        }
        const { src } = (await res.json()) as { src: string };
        editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[a-z0-9]+$/i, "") }).run();
        dirtyRef.current = true;
        setSaveState("dirty");
      } catch {
        setMessage("Image upload failed — check your connection.");
      }
    }
  }

  // Load the note once.
  useEffect(() => {
    fetch(`/api/admin/notes/${noteId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((n) => {
        const rec = n as NoteRecord;
        setNote(rec);
        setTitle(rec.title);
        revisionRef.current = rec.draft_revision;
        editor?.commands.setContent(JSON.parse(rec.document));
      })
      .catch(() => setMessage("Could not load note"));
  }, [noteId, editor]);

  const save = useCallback(async () => {
    if (!editor || !dirtyRef.current) return;
    setSaveState("saving");
    const doc = editor.getJSON();
    const expected = revisionRef.current;
    const res = await fetch(`/api/admin/notes/${noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: expected, title, document: doc }),
    });
    if (res.status === 409) {
      setSaveState("conflict");
      return;
    }
    if (!res.ok) {
      setSaveState("error");
      return;
    }
    const data = (await res.json()) as { revision: number };
    revisionRef.current = data.revision;
    dirtyRef.current = false;
    setSaveState("saved");
  }, [editor, noteId, title]);

  // Debounced autosave — typed text is never sent more often than every 1.5s.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(save, 1500);
    return () => clearTimeout(t);
  }, [saveState, save]);

  // Save on tab close / navigation.
  useEffect(() => {
    const handler = () => {
      if (dirtyRef.current) {
        navigator.sendBeacon?.(
          `/api/admin/notes/${noteId}`,
          new Blob([JSON.stringify({ expectedRevision: revisionRef.current, title, document: editor?.getJSON() })], { type: "application/json" }),
        );
      }
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [noteId, title, editor]);

  async function publish() {
    setPublishing(true);
    setMessage(null);
    await save(); // flush pending edits first
    const res = await fetch(`/api/admin/notes/${noteId}/publish`, { method: "POST" });
    setPublishing(false);
    if (res.ok) {
      const data = (await res.json()) as {
        slug: string;
        draftRevision: number;
        publicRevision: number;
        jobStatus: "committed" | "failed";
      };
      revisionRef.current = data.draftRevision;
      setNote((n) => (n ? { ...n, visibility: "published", slug: data.slug, public_revision: data.publicRevision } : n));
      setMessage(
        data.jobStatus === "failed"
          ? "Published (live via /notes) — but the GitHub export failed; retry from the list."
          : "Published. Live now at /notes; the static /posts page appears after the next build (~1–2 min).",
      );
    } else {
      setMessage("Publish failed.");
    }
  }

  async function unpublish() {
    setPublishing(true);
    const res = await fetch(`/api/admin/notes/${noteId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unpublish" }),
    });
    setPublishing(false);
    if (res.ok) {
      setNote((n) => (n ? { ...n, visibility: "unpublished" } : n));
      setMessage("Unpublished. Hidden from lists now; the /posts URL disappears after the next build.");
    } else {
      setMessage("Unpublish failed.");
    }
  }

  if (!note) return <p style={{ color: "var(--text-muted)" }}>{message ?? "Loading…"}</p>;

  const stateLabel: Record<SaveState, string> = {
    idle: "",
    dirty: "unsaved…",
    saving: "saving…",
    saved: "saved",
    conflict: "conflict — another tab saved newer changes. Copy your text, reload, and re-apply.",
    error: "save failed — will retry on next keystroke",
  };

  return (
    <div>
      <input
        value={title}
        placeholder="Title"
        onChange={(e) => {
          setTitle(e.target.value);
          dirtyRef.current = true;
          setSaveState("dirty");
        }}
        style={{
          width: "100%",
          font: "inherit",
          fontSize: "1.5rem",
          fontWeight: 700,
          border: "none",
          outline: "none",
          padding: 0,
          marginBottom: "0.5rem",
          background: "transparent",
          color: "var(--text)",
        }}
      />

      <Toolbar editor={editor} />

      <EditorContent editor={editor} />

      <hr style={{ margin: "2rem 0 1rem" }} />
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
        {note.visibility !== "published" ? (
          <button onClick={publish} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish"}
          </button>
        ) : (
          <>
            <span className="badge">live · rev {note.public_revision}</span>
            <button onClick={publish} disabled={publishing}>
              {publishing ? "Publishing…" : "Republish changes"}
            </button>
            <button onClick={unpublish} disabled={publishing} style={{ color: "var(--danger)" }}>
              Unpublish
            </button>
          </>
        )}
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{stateLabel[saveState]}</span>
      </div>
      {message && (
        <p style={{ background: "var(--accent-soft)", padding: "0.6rem 0.9rem", borderRadius: 8, fontSize: "0.9rem" }}>
          {message}
        </p>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (active: boolean): React.CSSProperties => ({
    border: "1px solid var(--border)",
    background: active ? "var(--accent-soft)" : "transparent",
    borderRadius: 6,
    padding: "0.15rem 0.5rem",
    marginRight: 4,
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.85rem",
  });
  const items: Array<[string, string, () => void]> = [
    ["B", "bold", () => editor.chain().focus().toggleBold().run()],
    ["I", "italic", () => editor.chain().focus().toggleItalic().run()],
    ["S", "strike", () => editor.chain().focus().toggleStrike().run()],
    ["</>", "code", () => editor.chain().focus().toggleCode().run()],
    ["H2", "h2", () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
    ["H3", "h3", () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
    ["•", "bullet", () => editor.chain().focus().toggleBulletList().run()],
    ["1.", "ordered", () => editor.chain().focus().toggleOrderedList().run()],
    ["❝", "quote", () => editor.chain().focus().toggleBlockquote().run()],
    ["{ }", "codeblock", () => editor.chain().focus().toggleCodeBlock().run()],
    ["—", "hr", () => editor.chain().focus().setHorizontalRule().run()],
  ];
  return (
    <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap" }}>
      {items.map(([label, key, run]) => (
        <button key={key} style={btn(false)} onMouseDown={(e) => { e.preventDefault(); run(); }}>
          {label}
        </button>
      ))}
      <button style={btn(false)} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().undo().run(); }}>↺</button>
      <button style={btn(false)} onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().redo().run(); }}>↻</button>
    </div>
  );
}
