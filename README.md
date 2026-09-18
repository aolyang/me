# me — personal blog + quick notes

One Cloudflare Worker serving:

- **`/posts/:slug`** — static articles. Two kinds share this URL space:
  - hand-written MDX with React islands (`content/posts/*.mdx`)
  - quick notes published from the web editor (JSON exported to `content/notes/*.json`)
- **`/notes/:id`** — instant public URL for a just-published note (SSR from a
  D1 snapshot). 302-redirects to `/posts/:slug` once the static build catches
  up with the published revision.
- **`/editor`** — TipTap editor behind Cloudflare Access: autosave, publish,
  unpublish, paste-image upload (R2), comment moderation.

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
D1 (notes, snapshots, jobs, media metadata, comments) · R2 (images) ·
Cloudflare Access (author auth) · Turnstile (comment anti-bot) ·
GitHub Actions (build + deploy).

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
admin APIs are open (no Access), Turnstile verification is skipped.
Create `.dev.vars` (gitignored) to exercise the hardened paths:

```
GITHUB_REPO=you/you-blog
GITHUB_TOKEN=github_pat_...        # fine-grained PAT, Contents: RW, this repo only
ACCESS_TEAM=yourteam.cloudflareaccess.com
ACCESS_AUD=<access application aud tag>
TURNSTILE_SECRET=0x...
```

### Testing auth locally (three layers)

Cloudflare Access's real login page (email OTP etc.) is an edge service —
it can never appear under `wrangler dev`. Local testing covers the layers
you own:

1. **Fail-closed** (no `.dev.vars` → with): set `ACCESS_TEAM`/`ACCESS_AUD`
   to any value → every admin call without a JWT returns 401.
2. **Full JWT verification chain** — the mock JWKS tool mints a valid,
   properly-signed Access-shaped token and serves the JWKS endpoint the
   Worker fetches:
   ```bash
   # .dev.vars:
   #   ACCESS_TEAM=127.0.0.1:8788
   #   ACCESS_AUD=dev-aud
   node scripts/dev-access-token.mjs        # terminal 1: JWKS server + token
   pnpm preview                             # terminal 2
   curl -H "Cf-Access-Jwt-Assertion: <token>" http://127.0.0.1:8787/api/admin/notes
   ```
   Verified: valid token → 200; tampered payload (signature now invalid)
   → 401; no token → 401. Tampering test: change the payload JSON,
   keep the original signature.
3. **Real Access login** — only after deploy. Configure the Zero Trust app
   (README §production setup), open `/editor` in a browser, complete the
   OTP email flow, and confirm the Worker accepts the edge-injected JWT.

Note: browser-based editor testing with a token (layer 2) works too —
set the header via a devtools override extension, or just curl the APIs.
The editor page itself never enforces auth (Access protects it at the
edge in production; the APIs fail closed on their own).

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
   - `GITHUB_TOKEN` — fine-grained PAT scoped to this repo, Contents read/write
   - `GITHUB_REPO` — `owner/repo`
   - `ACCESS_TEAM`, `ACCESS_AUD` — from step 3
   - `TURNSTILE_SECRET` — from step 4
3. **Cloudflare Access (Zero Trust, free)**: create a self-hosted app for the
   worker domain with two path rules — `/editor` and `/api/admin` — policy:
   allow your email (login method: one-time PIN or GitHub/Google). Copy the
   app's **AUD tag** into `ACCESS_AUD` and your team host into `ACCESS_TEAM`.
4. **Turnstile**: create a managed widget for the domain → site key goes into
   the Comments island host attribute (`data-turnstile-key` on the
   `<section>` wrapper in `[...slug].astro` / `notes/[id].astro` if you want
   the widget; omitted = no widget rendered), secret into `TURNSTILE_SECRET`.
5. **GitHub Actions**: repo secret `CLOUDFLARE_API_TOKEN` (permission:
   Workers Scripts — Edit, plus Account-level Workers Deployments if your
   account requires it). Push to `main` → build + `wrangler deploy`.
6. Set `site:` in `astro.config.mjs` to your real origin (RSS absolute URLs).
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
src/lib/                     db, env, auth (Access JWT), github, publish,
                             resolver (revision routing), tiptap-render,
                             turnstile, slug
src/pages/                   index (SSR merged list), posts/[...slug] (static),
                             notes/[id] (SSR/302), editor/*, api/admin/*,
                             api/public/comments, media/[...key], rss.xml
src/components/editor/       NoteList, NoteEditor (TipTap), ModerationQueue
src/components/Comments.tsx  public comments island (used on both page kinds)
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
- **Comments** are anonymous, plain-text only, Turnstile-gated, held for
  approval, keyed by stable content id (note id or post `commentId`) so a
  note's dynamic and static pages share one thread.
- **Delete vs unpublish**: deleting a published note is blocked until you
  unpublish it. Unpublish hides it immediately; the static URL disappears
  after the next deploy.
