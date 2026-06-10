# Idea: Serve the workspace file sidebar from the bridge (+ git status & diffs)

Status: implemented (2026-06-10) — as a **separate package**, `packages/workspace-server`
(`@tavon-ai/workspace-server`), mounted by the `pi-bridge` CLI as composition root
(`--no-workspace` to disable). Endpoints live under `/api/workspace/*`. Git status
and per-file diffs included; dirty markers + diff view in `examples/chat`.

## Motivation

The chat example (`examples/chat`) has a left sidebar showing the workspace file
tree and a right artifact panel showing file contents. Both are currently served
by a Vite dev-server middleware in `examples/chat/vite.config.ts`, which walks the
**example's own directory**.

Two problems:

1. **Workspace mismatch.** The bridge runs Pi with its own `--cwd`. Today the
   example's `bridge` script (`pnpm --dir ../.. bridge --cwd .`) resolves `--cwd`
   to the **repo root**, so Pi lists/creates files (e.g. `helloworld.md`) that the
   sidebar never shows.
2. **Vision: Pi and the bridge don't necessarily run on the same machine as the
   web UI.** A Vite middleware can only show files local to the UI process. The
   file tree must come from wherever Pi actually operates — the bridge.

## Design

### Bridge API additions (`packages/bridge`)

New handler, e.g. `src/server/create-files-handler.ts`, taking `{ cwd, basePath }`
like `createPiChatHandler` and exported from `index.ts` for embedders:

- `GET /api/files` → `{ root, files: FileTreeNode[] }`
  - Tree walk of `cwd` (skip `node_modules`, `.git`, `dist`, …).
  - Deliberately **no git info in the tree nodes**, so status can be polled
    separately without re-walking the filesystem.
- `GET /api/files/content?path=…` → `{ path, content }`
  - Path-traversal guard: resolve against `cwd`, reject anything outside.

New requirement — git awareness:

- `GET /api/git/status` → `{ branch, files: { "src/main.tsx": "modified", "new.md": "untracked", … } }`
  - One `git status --porcelain -z` invocation in `cwd`, parsed to a path→status map.
  - Empty map when `cwd` is not a git repo (UI degrades gracefully).
- `GET /api/git/diff?path=…` → `{ path, diff }`
  - `git diff HEAD -- <path>` for tracked files.
  - Untracked files: synthesize an all-added diff (`git diff --no-index /dev/null <path>`).
  - Same traversal guard as the content endpoint.

Wiring: mount the files/git handler in `cli.ts` next to the chat handler (try
files handler, fall through to chat). Both get the same `cwd`, so the sidebar and
Pi see the same workspace **by construction** — fixing the mismatch regardless of
how `--cwd` is resolved.

### Reaching a remote bridge

- **Recommended: keep the Vite proxy pattern.** Add `/api/files` (and `/api/git`)
  to `server.proxy` targeting `PI_BRIDGE_ORIGIN`. Pointing that env var at a
  remote bridge then covers chat, files, and git with no CORS work.
- Alternative: browser hits the bridge directly (`VITE_PI_BRIDGE_API` as absolute
  URL) — requires `hono/cors` on the bridge.
- Trust model note: the bridge already lets Pi read/write workspace files over
  HTTP, so read-only file/git endpoints don't widen exposure. But a
  network-reachable bridge (non-localhost host) deserves an auth story, even just
  a shared token header.

### Example/UI changes (`examples/chat`)

- Delete the `fileTreeApi` plugin from `vite.config.ts`; add `/api/files` and
  `/api/git` to the proxy. Frontend endpoints/shapes stay identical.
- **Dirty markers in the tree:** the vendored `FileTreeFile` accepts
  `icon`/`children` overrides, so a small wrapper can render dirty files with an
  amber name + dot, and folders containing dirty files get a dot (computed
  client-side from the status map).
- **Diff in the artifact panel:** when the opened file is dirty, show a
  File / Diff toggle in the artifact header (`ArtifactAction`). Render the diff
  with the existing `CodeBlock` and `language="diff"` (shiki highlights unified
  diffs; no new dependency).
- **Refresh:** the app already refetches the tree after each completed
  `write`/`edit` tool call; the same hook refetches `/api/git/status` so files
  turn dirty as Pi edits them.
- Optional later: a file-watcher SSE endpoint on the bridge so the sidebar
  updates without polling.

## Sequencing

1. **Foundation:** bridge files handler (tree + content) + proxy switch
   (~+100 lines bridge, −40 in vite config; frontend unchanged).
2. **Git status:** `/api/git/status` + dirty markers in the tree (small).
3. **Diffs:** `/api/git/diff` + File/Diff toggle in the artifact panel
   (pure frontend on top of 2).

Each layer builds on the previous; nothing in the foundation needs rework later.
