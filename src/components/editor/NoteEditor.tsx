import { useEffect, useState, useCallback, useRef } from "react";
import { EditorContent, useEditor, ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { BubbleMenu } from "@tiptap/react/menus";
import tippy from "tippy.js";
import "tippy.js/dist/tippy.css";
import { contentExtensions } from "../../content-extensions";
import { SlashCommands, type SlashCommandItem } from "./slash-commands";
import SlashMenu from "./SlashMenu";
import Placeholder from "@tiptap/extension-placeholder";;

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
    extensions: [
      ...contentExtensions, // StarterKit 3 already includes Link
      Placeholder.configure({ placeholder: "写点什么… 输入 / 打开命令菜单" }),
      SlashCommands.configure({
        suggestion: {
          render: () => {
            let component: ReactRenderer<{ onKeyDown: (p: unknown) => boolean }> | null = null;
            let popup: Array<{ setProps: (p: object) => void; hide: () => void; destroy: () => void }> | null = null;

            return {
              onStart: (props: SuggestionProps<SlashCommandItem>) => {
                // use the editor FROM the props — the `editor` closure captured
                // at useEditor() time may still be null on first render.
                component = new ReactRenderer(SlashMenu, {
                  editor: props.editor,
                  props,
                });
                const rect = props.clientRect?.();
                if (!rect) return;
                popup = tippy(document.body, {
                  getReferenceClientRect: () => rect as DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                });
              },
              onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
                component?.updateProps(props);
                const rect = props.clientRect?.();
                const inst = popup?.[0];
                if (rect && inst) {
                  inst.setProps({ getReferenceClientRect: () => rect as DOMRect });
                }
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                const inst = popup?.[0];
                if (props.event.key === "Escape") {
                  inst?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.[0]?.destroy();
                popup = null;
                component?.destroy();
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: { type: "doc", content: [] },
    editorProps: {
      // Paste/drop an image → upload to R2 → insert media:// node.
      handlePaste: (_view, event) => {
        const hasImage = Array.from(event.clipboardData?.files ?? []).some((f) =>
          f.type.startsWith("image/"),
        );
        if (hasImage) void handleMediaInsert(event.clipboardData);
        return hasImage;
      },
      handleDrop: (_view, event) => {
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
          setMessage(`图片上传失败 (${res.status})`);
          continue;
        }
        const { src } = (await res.json()) as { src: string };
        editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[a-z0-9]+$/i, "") }).run();
        dirtyRef.current = true;
        setSaveState("dirty");
      } catch {
        setMessage("图片上传失败 — 检查网络连接");
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
      .catch(() => setMessage("无法加载笔记"));
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

  // Debounced autosave.
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
          new Blob(
            [JSON.stringify({ expectedRevision: revisionRef.current, title, document: editor?.getJSON() })],
            { type: "application/json" },
          ),
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
          ? "已发布(通过 /notes 立即可见)— 但 GitHub 导出失败,可从列表重试。"
          : "已发布。/notes 立即可见;静态 /posts 页面将在下次构建后出现(约 1–2 分钟)。",
      );
    } else {
      setMessage("发布失败。");
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
      setMessage("已下架。列表立即隐藏;/posts 地址将在下次构建后消失。");
    } else {
      setMessage("下架失败。");
    }
  }

  function addLink() {
    if (!editor) return;
    const url = window.prompt("链接地址", "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  }

  if (!note) return <p style={{ color: "var(--text-faint)" }}>{message ?? "加载中…"}</p>;

  const stateLabel: Record<SaveState, string> = {
    idle: "",
    dirty: "未保存…",
    saving: "保存中…",
    saved: "已保存",
    conflict: "冲突 — 另一个标签页保存了更新的内容。复制当前文字后刷新再粘贴。",
    error: "保存失败 — 下次输入时重试",
  };

  return (
    <div>
      <input
        className="title-input"
        value={title}
        placeholder="标题"
        onChange={(e) => {
          setTitle(e.target.value);
          dirtyRef.current = true;
          setSaveState("dirty");
        }}
      />

      {editor && (
        <BubbleMenu editor={editor} options={{ tippyOptions: { duration: 120 } }} className="bubble-menu">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
            title="粗体"
          >
            B
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
            title="斜体"
          >
            I
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive("code") ? "is-active" : ""}
            title="行内代码"
          >
            {"</>"}
          </button>
          <button
            onClick={addLink}
            className={editor.isActive("link") ? "is-active" : ""}
            title="链接"
          >
            🔗
          </button>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />

      <div className="publish-row">
        {note.visibility !== "published" ? (
          <button className="btn--primary" onClick={publish} disabled={publishing}>
            {publishing ? "发布中…" : "发布"}
          </button>
        ) : (
          <>
            <span className="chip chip--ok">已发布 · rev {note.public_revision}</span>
            <button className="btn--primary" onClick={publish} disabled={publishing}>
              {publishing ? "发布中…" : "重新发布修改"}
            </button>
            <button className="btn--danger" onClick={unpublish} disabled={publishing}>
              下架
            </button>
          </>
        )}
        <span className="status">{stateLabel[saveState]}</span>
        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  );
}
