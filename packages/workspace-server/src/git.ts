import { execFile } from "node:child_process";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface GitStatusResult {
  repo: boolean;
  branch: string | null;
  /** Workspace-relative path → status. Only includes paths inside the workspace. */
  files: Record<string, GitFileStatus>;
}

interface GitRunResult {
  stdout: string;
  exitCode: number;
}

async function runGit(cwd: string, args: string[]): Promise<GitRunResult> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; code?: number | string };
    if (failure.code === "ENOENT") throw new Error("git binary not found on PATH");
    return { stdout: failure.stdout ?? "", exitCode: typeof failure.code === "number" ? failure.code : 1 };
  }
}

async function gitToplevel(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function gitBranch(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

function statusFromCodes(x: string, y: string): GitFileStatus {
  const xy = x + y;
  if (xy === "??") return "untracked";
  if (x === "U" || y === "U" || xy === "AA" || xy === "DD") return "conflicted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/**
 * Git status for the workspace at `cwd`. Porcelain paths are relative to the
 * repository toplevel, which may be above `cwd`; results are re-relativized to
 * `cwd` and entries outside it are dropped.
 */
export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  const toplevel = await gitToplevel(cwd);
  if (!toplevel) return { repo: false, branch: null, files: {} };

  const branch = await gitBranch(cwd);
  const result = await runGit(cwd, ["status", "--porcelain", "-z"]);
  const files: Record<string, GitFileStatus> = {};

  const chunks = result.stdout.split("\0");
  for (let i = 0; i < chunks.length; i += 1) {
    const entry = chunks[i];
    if (!entry || entry.length < 4) continue;
    const x = entry[0] ?? " ";
    const y = entry[1] ?? " ";
    const toplevelRelative = entry.slice(3);
    // Rename/copy entries are followed by the original path in the next chunk.
    if (x === "R" || x === "C") i += 1;

    const absolute = join(toplevel, toplevelRelative);
    if (absolute !== cwd && !absolute.startsWith(cwd + sep)) continue;
    files[relative(cwd, absolute)] = statusFromCodes(x, y);
  }

  return { repo: true, branch, files };
}

/**
 * Unified diff for a single workspace-relative path. Untracked files (and any
 * path `git diff HEAD` can't handle, e.g. on an unborn branch) are diffed
 * against /dev/null so new content shows as additions. Clean files yield "".
 */
export async function gitDiff(cwd: string, path: string): Promise<string> {
  const status = await runGit(cwd, ["status", "--porcelain", "-z", "--", path]);
  const untracked = status.stdout.split("\0")[0]?.startsWith("??") ?? false;

  if (!untracked) {
    const tracked = await runGit(cwd, ["diff", "HEAD", "--", path]);
    if (tracked.exitCode === 0) return tracked.stdout;
    // fall through for paths `git diff HEAD` can't handle (e.g. unborn branch)
  }

  // `git diff --no-index` exits 1 when the files differ; the diff is on stdout.
  const result = await runGit(cwd, ["diff", "--no-index", "--", "/dev/null", path]);
  return result.stdout;
}
