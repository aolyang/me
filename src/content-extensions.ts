import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

// The single source of truth for supported editor content. Used by BOTH the
// editor (src/components/editor/NoteEditor.tsx) and the static renderer
// (src/lib/tiptap-render.ts) so a published page always matches the preview.
//
// Image srcs use the media:// scheme (media://notes/<noteId>/<id>.<ext>).
// The DOM in the EDITOR rewrites media:// -> /media/ for display (browsers
// can't fetch media://), while the doc JSON keeps the stable media:// form;
// lib/tiptap-render does the same rewrite when rendering published HTML.
export const contentExtensions = [
  StarterKit,
  Image.extend({
    renderHTML({ HTMLAttributes }) {
      const src =
        typeof HTMLAttributes.src === "string" && HTMLAttributes.src.startsWith("media://")
          ? HTMLAttributes.src.replace(/^media:\/\//, "/media/")
          : HTMLAttributes.src;
      return ["img", { ...HTMLAttributes, src }];
    },
  }),
];

/** media://notes/<noteId>/<file> -> /media/notes/<noteId>/<file> */
export function mediaSrcToUrl(html: string): string {
  return html.replaceAll('src="media://', 'src="/media/');
}
