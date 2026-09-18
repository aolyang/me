import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { contentExtensions, mediaSrcToUrl } from "../content-extensions";

// Build-time (and SSR) TipTap JSON → HTML. Runs server-side with no browser
// and no editor instance. media:// srcs are rewritten to /media/ URLs here
// so both the static build and the /notes/:id SSR produce servable pages.
export function renderNoteHtml(document: { type: "doc" } & Record<string, unknown>): string {
  const html = renderToHTMLString({
    content: document,
    extensions: contentExtensions,
  });
  return mediaSrcToUrl(html);
}
