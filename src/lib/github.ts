// GitHub Contents API client for exporting published notes as JSON files
// into content/notes/. Token: fine-grained PAT with Contents read/write on
// this repo only (Worker secret GITHUB_TOKEN).
import { runtimeEnv } from "./env";
import type { NoteExportFile } from "./types";

const API = "https://api.github.com";

function authHeaders(): HeadersInit {
  const token = runtimeEnv.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "me-notes-worker",
  };
}

function contentsUrl(path: string): string {
  return `${API}/repos/${runtimeEnv.GITHUB_REPO}/contents/${path}`;
}

/** PUT a file, creating or updating it. Returns the commit SHA. */
export async function putFile(path: string, content: string, message: string): Promise<string> {
  const token = runtimeEnv.GITHUB_TOKEN;
  if (!token || !runtimeEnv.GITHUB_REPO) {
    throw new Error("GITHUB_TOKEN / GITHUB_REPO not configured");
  }

  // Determine existing blob SHA for updates (404 = create).
  let sha: string | undefined;
  const head = await fetch(contentsUrl(path), { headers: authHeaders() });
  if (head.status === 200) {
    sha = ((await head.json()) as { sha: string }).sha;
  } else if (head.status !== 404) {
    throw new Error(`github read ${path}: ${head.status}`);
  }

  const res = await fetch(contentsUrl(path), {
    method: "PUT",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      message,
      // GitHub expects base64 of the UTF-8 bytes.
      content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
      sha,
    }),
  });

  if (!res.ok) {
    // 409 conflict: file changed since we read its SHA — one retry with fresh SHA.
    if (res.status === 409) {
      const retryHead = await fetch(contentsUrl(path), { headers: authHeaders() });
      if (retryHead.status === 200) {
        const freshSha = ((await retryHead.json()) as { sha: string }).sha;
        const retry = await fetch(contentsUrl(path), {
          method: "PUT",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({
            message,
            content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
            sha: freshSha,
          }),
        });
        if (retry.ok) {
          return ((await retry.json()) as { commit: { sha: string } }).commit.sha;
        }
        throw new Error(`github put retry ${path}: ${retry.status}`);
      }
    }
    throw new Error(`github put ${path}: ${res.status} ${await res.text()}`);
  }

  return ((await res.json()) as { commit: { sha: string } }).commit.sha;
}

/** DELETE a file (unpublish). Returns the commit SHA. */
export async function deleteFile(path: string, message: string): Promise<string> {
  if (!runtimeEnv.GITHUB_TOKEN || !runtimeEnv.GITHUB_REPO) {
    throw new Error("GITHUB_TOKEN / GITHUB_REPO not configured");
  }
  const head = await fetch(contentsUrl(path), { headers: authHeaders() });
  if (head.status === 404) return "already-deleted";
  if (head.status !== 200) throw new Error(`github read ${path}: ${head.status}`);
  const sha = ((await head.json()) as { sha: string }).sha;

  const res = await fetch(contentsUrl(path), {
    method: "DELETE",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ message, sha }),
  });
  if (!res.ok) throw new Error(`github delete ${path}: ${res.status}`);
  return ((await res.json()) as { commit: { sha: string } }).commit.sha;
}

export function notePath(noteId: string): string {
  return `content/notes/${noteId}.json`;
}

export function noteFileContent(export_: NoteExportFile): string {
  return `${JSON.stringify(export_, null, 2)}\n`;
}
