import { realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { gitDiff, gitStatus } from "./git.js";
import { DEFAULT_IGNORE, readTree } from "./tree.js";

export interface CreateWorkspaceHandlerOptions {
  /** Workspace directory to expose. Default: process.cwd(). */
  cwd?: string;
  /** URL prefix for all routes. Default: "/api/workspace". */
  basePath?: string;
  /** Entry names to skip in the tree walk. Default: DEFAULT_IGNORE. */
  ignore?: string[];
  /** Max bytes returned by the content endpoint before truncating. Default: 2 MiB. */
  maxFileSize?: number;
}

/**
 * Framework-agnostic handler exposing a workspace directory over HTTP:
 *
 *   GET {basePath}/files                 → { root, files }
 *   GET {basePath}/files/content?path=…  → { path, content, binary, truncated, size }
 *   GET {basePath}/git/status            → { repo, branch, files }
 *   GET {basePath}/git/diff?path=…       → { path, diff }
 *
 * Returns a `(Request) => Promise<Response>` usable directly as a Next.js
 * route handler, with Hono/Bun/Deno, or behind @hono/node-server.
 */
export function createWorkspaceHandler(
  options: CreateWorkspaceHandlerOptions = {},
): (request: Request) => Promise<Response> {
  // realpath so comparisons line up with git output, which resolves symlinks
  // (e.g. /var → /private/var on macOS).
  const cwd = realpathSync(resolve(options.cwd ?? process.cwd()));
  const basePath = normalizeBasePath(options.basePath ?? "/api/workspace");
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
  const maxFileSize = options.maxFileSize ?? 2 * 1024 * 1024;

  return async function handleWorkspace(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = stripTrailingSlash(url.pathname);
    if (request.method !== "GET" || !path.startsWith(basePath)) {
      return json({ error: "Not found" }, 404);
    }
    const route = path.slice(basePath.length);

    try {
      switch (route) {
        case "/files":
          return json({ root: cwd, files: await readTree(cwd, ignore) });
        case "/files/content":
          return await handleContent(cwd, url.searchParams.get("path"), maxFileSize);
        case "/git/status":
          return json(await gitStatus(cwd));
        case "/git/diff":
          return await handleDiff(cwd, url.searchParams.get("path"));
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (error) {
      return json({ error: getErrorMessage(error) }, 500);
    }
  };
}

async function handleContent(cwd: string, requested: string | null, maxFileSize: number): Promise<Response> {
  const guarded = await resolveWithinWorkspace(cwd, requested, { mustExist: true });
  if (guarded.error) return guarded.error;

  const info = await stat(guarded.absolute);
  if (!info.isFile()) return json({ error: "Not a file" }, 400);

  const length = Math.min(info.size, maxFileSize);
  const buffer = Buffer.alloc(length);
  const handle = await open(guarded.absolute, "r");
  try {
    await handle.read(buffer, 0, length, 0);
  } finally {
    await handle.close();
  }

  const binary = buffer.subarray(0, 8000).includes(0);
  return json({
    path: guarded.relative,
    content: binary ? null : buffer.toString("utf-8"),
    binary,
    truncated: info.size > maxFileSize,
    size: info.size,
  });
}

async function handleDiff(cwd: string, requested: string | null): Promise<Response> {
  // No existence requirement: deleted files still have a diff.
  const guarded = await resolveWithinWorkspace(cwd, requested, { mustExist: false });
  if (guarded.error) return guarded.error;
  return json({ path: guarded.relative, diff: await gitDiff(cwd, guarded.relative) });
}

interface GuardedPath {
  absolute: string;
  relative: string;
  error?: Response;
}

async function resolveWithinWorkspace(
  cwd: string,
  requested: string | null,
  { mustExist }: { mustExist: boolean },
): Promise<GuardedPath> {
  const fail = (status: number, message: string): GuardedPath => ({
    absolute: "",
    relative: "",
    error: json({ error: message }, status),
  });

  if (!requested) return fail(400, "Missing path parameter");

  const absolute = resolve(cwd, requested);
  if (absolute !== cwd && !absolute.startsWith(cwd + sep)) {
    return fail(403, "Path outside workspace");
  }

  // Re-check after resolving symlinks so links can't escape the workspace.
  try {
    const real = await realpath(absolute);
    const realRoot = await realpath(cwd);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      return fail(403, "Path outside workspace");
    }
  } catch {
    if (mustExist) return fail(404, "Not found");
  }

  return { absolute, relative: absolute === cwd ? "." : absolute.slice(cwd.length + 1) };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeBasePath(basePath: string): string {
  return stripTrailingSlash(basePath.startsWith("/") ? basePath : `/${basePath}`);
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
