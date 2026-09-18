import type { APIRoute } from "astro";
import { mergedList } from "../lib/resolver";

export const prerender = false;

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// GET /rss.xml — feed from the same merged list as the home page
// (D1 live notes + deployed static posts, newest first). Hand-rolled XML:
// RSS 2.0 is small enough that a builder dependency isn't worth it.
export const GET: APIRoute = async ({ site }) => {
  const entries = await mergedList();
  const origin = site?.origin ?? "https://example.com";

  const items = entries
    .slice(0, 50)
    .map(
      (e) =>
        `    <item>\n      <title>${esc(e.title)}</title>\n      <link>${origin}${e.href}</link>\n      <guid>${origin}${e.href}</guid>\n      <pubDate>${new Date(e.date).toUTCString()}</pubDate>\n    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>me</title>
    <link>${origin}</link>
    <description>posts and notes</description>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
