// The routing resolver: decides, for every note, whether its canonical
// public URL is the static /posts/:slug (deployed collection caught up with
// D1's public revision) or the dynamic /notes/:id (build still in flight /
// failed — D1 snapshot is the truth). Derived from revision comparison,
// never from a stored flag.

import { getCollection } from "astro:content";
import { listNotes } from "./db";
import type { NoteRecord } from "./types";

export type NoteRouteDecision =
  | { kind: "redirect"; slug: string; revision: number } // -> /posts/:slug
  | { kind: "ssr"; note: NoteRecord } // serve D1 snapshot at /notes/:id
  | { kind: "gone" }; // unpublished / deleted / never published

export interface ListEntry {
  title: string;
  href: string;
  date: string; // ISO
  kind: "note" | "post";
}

/** Revision currently present in the DEPLOYED static build, by noteId. */
export async function deployedNoteRevisions(): Promise<Map<string, number>> {
  try {
    const notes = await getCollection("notes");
    return new Map(notes.map((n) => [n.data.noteId, n.data.revision]));
  } catch {
    return new Map(); // collection unavailable (e.g. empty) — treat as "none deployed"
  }
}

export function decideNoteRoute(note: NoteRecord, deployedRevision: number | undefined): NoteRouteDecision {
  if (note.deleted_at || note.visibility !== "published" || note.public_revision === null) {
    return { kind: "gone" };
  }
  if (deployedRevision === note.public_revision) {
    return { kind: "redirect", slug: note.slug!, revision: note.public_revision };
  }
  return { kind: "ssr", note };
}

/**
 * Merged home-page list: D1 published notes ∪ deployed notes collection ∪
 * posts collection. D1 tombstones win over the embedded collection so an
 * unpublished note doesn't reappear from the last successful build.
 */
export async function mergedList(): Promise<ListEntry[]> {
  const [notes, deployedNotes, posts] = await Promise.all([
    listNotes(),
    getCollection("notes").catch(() => []),
    getCollection("posts", (p) => !p.data.draft).catch(() => []),
  ]);
  const deployed = new Map(deployedNotes.map((n) => [n.data.noteId, n]));

  const entries: ListEntry[] = [];
  const seenSlugs = new Set<string>();

  // Every D1 row that is NOT currently published is a tombstone: it must
  // suppress the stale deployed copy too (unpublish must hide the note from
  // lists even though the last build still contains it).
  for (const note of notes) {
    const decision = decideNoteRoute(note, deployed.get(note.id)?.data.revision);
    if (decision.kind === "gone") {
      deployed.delete(note.id);
      continue;
    }
    const slug = decision.kind === "redirect" ? decision.slug : note.slug!;
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    entries.push({
      title: note.title || "Untitled",
      href: decision.kind === "redirect" ? `/posts/${slug}/` : `/notes/${note.id}`,
      date: note.published_at ?? note.updated_at,
      kind: "note",
    });
    // D1 is authoritative for this note; don't also list the stale deployed copy.
    deployed.delete(note.id);
  }

  // Deployed notes with NO D1 row at all: published historically, then the
  // row was hard-deleted from D1. Keep them listed — the static page is
  // their only remaining representation.
  for (const entry of deployed.values()) {
    if (seenSlugs.has(entry.data.slug)) continue;
    seenSlugs.add(entry.data.slug);
    entries.push({
      title: entry.data.title,
      href: `/posts/${entry.data.slug}/`,
      date: entry.data.publishedAt,
      kind: "note",
    });
  }

  for (const post of posts) {
    if (seenSlugs.has(post.id)) continue;
    seenSlugs.add(post.id);
    entries.push({
      title: post.data.title,
      href: `/posts/${post.id}/`,
      date: post.data.publishedAt.toISOString(),
      kind: "post",
    });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
