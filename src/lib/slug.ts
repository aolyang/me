// Slug generation: lowercase, hyphenated, stable across rebuilds.
// Must not collide with hand-written posts (checked at publish time in
// publish.ts against the deployed notes collection).

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks from NFKD
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "note";
}
