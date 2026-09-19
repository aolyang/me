# me — personal blog + quick notes

One Cloudflare Worker serving:

- **`/posts/:slug`** — static articles. Two kinds share this URL space:
  - hand-written MDX with React islands (`content/posts/*.mdx`)
  - quick notes published from the web editor (JSON exported to `content/notes/*.json`)
- **`/notes/:id`** — instant public URL for a just-published note (SSR from a
  D1 snapshot). 302-redirects to `/posts/:slug` once the static build catches
  up with the published revision.
- **`/editor`** — TipTap editor behind password auth: autosave, publish,
  unpublish, paste-image upload (R2).

## How publishing works

```
Editor "Publish"
  ├─ 1. instantly public: D1 stores an immutable snapshot; /notes/:id serves it
  └─ 2. eventually static: GitHub commit of content/notes/<id>.json
        → Actions builds (astro build) → wrangler deploy → /posts/:slug live
        → /notes/:id now 302s to the static page (revision comparison)
```

GitHub/CI failures never take content offline: the note stays public via
`/notes/:id` and the export job is marked `failed`, retried automatically
when the editor loads (or via the "Retry failed exports" button).

Unpublishing is instant on the dynamic side (404 + hidden from lists) and
eventual on the static side (a delete commit + rebuild removes the page).

## Stack

Astro 7 (`output: "server"` + `@astrojs/cloudflare` unified entrypoint) ·
React 19 islands · TipTap 3 (+ `@tiptap/static-renderer` at build time) ·
D1 (notes, snapshots, jobs, media metadata) · R2 (images) ·
password + HMAC-signed-cookie auth (author) · giscus.app
(comments via GitHub Discussions) · GitHub Actions (build + deploy).

## Local development

```bash
# Node 22 required (Astro's emptyDir uses fs.rmdirSync recursive,
# removed in Node 24+)
npx fnm use 22   # or your node manager of choice

pnpm install
pnpm db:migrate:local   # create local D1 schema (miniflare sqlite)
pnpm build              # astro build → dist/
pnpm preview            # wrangler dev on :8787 with local D1/R2 bindings
```

Without `.dev.vars` secrets everything runs in local-dev mode:
admin APIs are open (no password).
Create `.dev.vars` (gitignored) to exercise the hardened paths:

```
AUTH_PASSWORD=<long random string>   # enables login + session cookies
GITHUB_REPO=you/you-blog
GITHUB_TOKEN=github_pat_...        # fine-grained PAT, Contents: RW, this repo only
```

### Testing auth locally

With `AUTH_PASSWORD` set in `.dev.vars`, the full login flow runs locally
(same code path as production):

```bash
pnpm preview
# browser: http://127.0.0.1:8787/editor/  → redirects to /login → enter password
# or curl:
curl -c cookies.txt -X POST http://127.0.0.1:8787/api/auth/login \
  -H 'content-type: application/json' -d '{"password":"..."}'
curl -b cookies.txt http://127.0.0.1:8787/api/admin/notes
```

Fail-closed checks: wrong password → 401 (with fixed delay), no cookie →
401 / editor redirects to /login, forged cookie (tampered HMAC) → 401.
Rotating `AUTH_PASSWORD` invalidates every existing session (the HMAC key
is derived from the password).

`pnpm dev` (astro dev) also works for pure frontend iteration, but bindings
come from the adapter's dev proxy; prefer `pnpm preview` for full fidelity.

## One-time production setup

1. **D1 + R2**
   ```bash
   wrangler d1 create me-notes          # paste database_id into wrangler.jsonc
   wrangler r2 bucket create me-media
   wrangler d1 execute DB --file migrations/0001_init.sql   # remote
   ```
2. **Secrets** (Worker → Settings → Variables, or `wrangler secret put`):
   - `AUTH_PASSWORD` — a long random string (generate: `openssl rand -base64 24`).
     This is the editor login. Rotating it logs out all devices.
   - `GITHUB_TOKEN` — fine-grained PAT scoped to this repo, Contents read/write
   - `GITHUB_REPO` — `owner/repo`
   - OAuth (optional, each provider independent):
     - GitHub OAuth App (github.com → Settings → Developer settings → OAuth Apps),
       callback `https://<origin>/api/auth/github/callback` → secrets
       `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
     - Google (console.cloud.google.com → APIs & Services → Credentials → OAuth
       client ID), callback `https://<origin>/api/auth/google/callback` → secrets
       `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
     - `AUTHOR_EMAILS` — comma-separated; ONLY these accounts can sign in
       (e.g. `you@gmail.com,you@users.noreply.github.com`). Any other account
       gets 403. Leave unset to allow any (not recommended).
   - Note: use `printf '%s' '<value>' | wrangler secret put NAME` — piping from
     `cat file` includes the trailing newline.
3. **giscus comments**: official [giscus.app](https://giscus.app) — install
   the public giscus GitHub App on the repo, pick the `Announcements`
   category. Site embeds the widget in src/components/GiscusComments.astro
   (mapping: specific term = contentId). Existing Discussions carry over
   unchanged — giscus.app reads the same repo data.
4. **GitHub Actions**: repo secret `CLOUDFLARE_API_TOKEN` (permission:
   Workers Scripts — Edit, plus Account-level Workers Deployments if your
   account requires it). Push to `main` → build + `wrangler deploy`.
5. Set `site:` in `astro.config.mjs` to your real origin (RSS absolute URLs).
7. Optional: custom domain / routes on the worker; consider disabling the
   public `workers.dev` route (Workers → Settings → Domains & Routes).

## Publishing complex articles (repo workflow)

Add `content/posts/<slug>.mdx` with frontmatter (`title`, `publishedAt`,
optional `commentId` for a stable comment thread, `draft: true` to hide),
import React components with a `client:*` directive, push to `main`. The
workflow builds and deploys; `/posts/<slug>` appears on the next build.

## Repo map

```
content/posts/*.mdx          hand-written articles
content/notes/*.json         exported published notes (created by the Worker)
migrations/0001_init.sql     D1 schema
src/content.config.ts        zod schemas for both collections
src/content-extensions.ts    TipTap extension set shared by editor + renderer
src/lib/                     db, env, auth (password+cookie), oauth (admin
                             GitHub login), github, publish, resolver
                             (revision routing), tiptap-render, slug
src/pages/                   index (SSR merged list), posts/[...slug] (static),
                             notes/[id] (SSR/302), editor/*, api/admin/*,
                             api/auth/*, media/[...key], rss.xml
src/components/editor/       NoteList, NoteEditor (TipTap, bubble+slash menus)
src/components/GiscusComments.astro  giscus widget (both page kinds)
```

## Notes on behavior

- **Editing after publish**: the web editor stays authoritative. "Republish"
  creates a new snapshot + commit; until the rebuild lands, `/notes/:id`
  serves the new revision while old `/posts/:slug` links show the previous
  one (minutes, not seconds).
- **Slug** is assigned at first publish from the title and then immutable.
- **Images** paste directly into the editor; they live in R2 under immutable
  keys and stay private until their note publishes. Images are never
  committed to git.
- **Comments** run on giscus.app; data lives in the aolyang/me repo
  Discussions. One thread per content id, shared between
  /notes/:id and /posts/:slug.
- **Delete vs unpublish**: deleting a published note is blocked until you
  unpublish it. Unpublish hides it immediately; the static URL disappears
  after the next deploy.
