import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { Editor as TipTapEditor } from "@tiptap/core";

// Slash command: typing "/" at the start of an empty paragraph opens the
// insert menu (headings, lists, code, quote, hr). Rendering lives in
// SlashMenu.tsx via the standard ReactRenderer pattern (wired in NoteEditor).

export interface SlashCommandItem {
  title: string;
  hint: string;
  command: (props: { editor: TipTapEditor; range: { from: number; to: number } }) => void;
}

export function slashItems({ query }: { query: string }): SlashCommandItem[] {
  const items: SlashCommandItem[] = [
    {
      title: "标题 2",
      hint: "H2",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
    },
    {
      title: "标题 3",
      hint: "H3",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
    },
    {
      title: "正文",
      hint: "P",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
      title: "无序列表",
      hint: "•",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: "有序列表",
      hint: "1.",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: "引用",
      hint: "❝",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "代码块",
      hint: "{ }",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: "分割线",
      hint: "—",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
  ];
  if (!query) return items;
  return items.filter(
    (i) =>
      i.title.toLowerCase().includes(query.toLowerCase()) ||
      i.hint.toLowerCase().includes(query.toLowerCase()),
  );
}

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: true,
        items: slashItems,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: TipTapEditor;
          range: { from: number; to: number };
          props: SlashCommandItem;
        }) => {
          props.command({ editor, range });
        },
      } as never, // render is injected by the editor component (ReactRenderer)
    };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
