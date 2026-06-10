# @tavon-ai/workspace-server

Framework-agnostic HTTP handler that exposes a workspace directory: file tree,
file contents, git status, and per-file diffs. Built as a companion to
[`@tavon-ai/pi-ai-sdk-bridge`](https://github.com/tavon-ai/pi-ai-sdk-bridge) so
a web UI can browse the same workspace a [Pi](https://github.com/badlogic/pi-mono)
coding agent operates on — including when the agent runs on a different machine
than the UI.

Zero runtime dependencies; git operations spawn the `git` binary on `PATH`.

## Endpoints

| Route | Response |
| --- | --- |
| `GET {basePath}/files` | `{ root, files: FileTreeNode[] }` |
| `GET {basePath}/files/content?path=…` | `{ path, content, binary, truncated, size }` |
| `GET {basePath}/git/status` | `{ repo, branch, files: { [path]: status } }` |
| `GET {basePath}/git/diff?path=…` | `{ path, diff }` |

- Paths are workspace-relative. Requests resolving outside the workspace
  (including via symlinks) are rejected with 403.
- Statuses: `modified | added | deleted | renamed | untracked | conflicted`.
- Untracked files diff against `/dev/null`, so new content shows as additions.
- Non-git workspaces return `{ repo: false, branch: null, files: {} }`.
- Binary files return `content: null, binary: true`. Files larger than
  `maxFileSize` (default 2 MiB) are truncated with `truncated: true`.

## Usage

The handler is a plain `(request: Request) => Promise<Response>`:

```ts
import { createWorkspaceHandler } from "@tavon-ai/workspace-server";

const handler = createWorkspaceHandler({ cwd: "/path/to/workspace" });
```

With Hono / `@hono/node-server`:

```ts
app.all("/api/workspace/*", (c) => handler(c.req.raw));
```

As a Next.js route handler (`app/api/workspace/[...route]/route.ts`):

```ts
const handler = createWorkspaceHandler();
export { handler as GET };
```

The `pi-bridge` CLI mounts this handler automatically next to the chat
endpoints (disable with `--no-workspace`).

## Options

| Option | Default | |
| --- | --- | --- |
| `cwd` | `process.cwd()` | Workspace directory to expose |
| `basePath` | `/api/workspace` | URL prefix |
| `ignore` | `node_modules`, `.git`, `dist`, … | Entry names skipped in the tree |
| `maxFileSize` | 2 MiB | Content endpoint truncation limit |

## Security

The handler is read-only but exposes every file under `cwd`. It does no
authentication or CORS — put it behind your composition root (reverse proxy,
auth middleware, or the Vite/Next dev proxy) before exposing it beyond
localhost.
