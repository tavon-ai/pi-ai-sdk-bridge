import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorkspaceHandler } from "../src/create-workspace-handler.js";
import type { FileTreeNode } from "../src/tree.js";

const execFileAsync = promisify(execFile);

let workspace: string;

const git = (cwd: string, ...args: string[]) =>
  execFileAsync("git", args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });

async function initRepo(cwd: string) {
  await git(cwd, "init", "-b", "main");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test");
}

async function call(handler: (request: Request) => Promise<Response>, path: string) {
  const response = await handler(new Request(`http://localhost${path}`));
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), "workspace-server-")));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("files", () => {
  it("returns the tree with directories first and ignores skipped names", async () => {
    await mkdir(join(workspace, "src"));
    await mkdir(join(workspace, "node_modules"));
    await writeFile(join(workspace, "src", "main.ts"), "export {};\n");
    await writeFile(join(workspace, "zebra.txt"), "z\n");

    const handler = createWorkspaceHandler({ cwd: workspace });
    const { status, body } = await call(handler, "/api/workspace/files");

    expect(status).toBe(200);
    expect(body.root).toBe(workspace);
    expect(body.files.map((node: FileTreeNode) => node.path)).toEqual(["src", "zebra.txt"]);
    expect(body.files[0].children).toEqual([{ name: "main.ts", path: "src/main.ts", type: "file" }]);
  });

  it("serves file content", async () => {
    await writeFile(join(workspace, "hello.txt"), "hello\n");
    const handler = createWorkspaceHandler({ cwd: workspace });
    const { status, body } = await call(handler, "/api/workspace/files/content?path=hello.txt");

    expect(status).toBe(200);
    expect(body).toMatchObject({ path: "hello.txt", content: "hello\n", binary: false, truncated: false });
  });

  it("flags binary files and truncates large ones", async () => {
    await writeFile(join(workspace, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(workspace, "big.txt"), "x".repeat(64));

    const handler = createWorkspaceHandler({ cwd: workspace, maxFileSize: 16 });
    const binary = await call(handler, "/api/workspace/files/content?path=blob.bin");
    expect(binary.body).toMatchObject({ binary: true, content: null });

    const big = await call(handler, "/api/workspace/files/content?path=big.txt");
    expect(big.body).toMatchObject({ truncated: true, content: "x".repeat(16), size: 64 });
  });

  it("rejects traversal and symlink escapes", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    await writeFile(join(outside, "secret.txt"), "secret\n");
    await symlink(join(outside, "secret.txt"), join(workspace, "link.txt"));

    const handler = createWorkspaceHandler({ cwd: workspace });
    expect((await call(handler, "/api/workspace/files/content?path=../../etc/passwd")).status).toBe(403);
    expect((await call(handler, "/api/workspace/files/content?path=link.txt")).status).toBe(403);
    expect((await call(handler, "/api/workspace/files/content?path=missing.txt")).status).toBe(404);

    await rm(outside, { recursive: true, force: true });
  });
});

describe("git", () => {
  it("returns repo:false outside a git repository", async () => {
    const handler = createWorkspaceHandler({ cwd: workspace });
    const { body } = await call(handler, "/api/workspace/git/status");
    expect(body).toEqual({ repo: false, branch: null, files: {} });
  });

  it("reports statuses for modified, untracked, added and deleted files", async () => {
    await initRepo(workspace);
    await writeFile(join(workspace, "committed.txt"), "v1\n");
    await writeFile(join(workspace, "doomed.txt"), "bye\n");
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-m", "init");

    await writeFile(join(workspace, "committed.txt"), "v2\n");
    await writeFile(join(workspace, "fresh.txt"), "new\n");
    await writeFile(join(workspace, "staged.txt"), "staged\n");
    await git(workspace, "add", "staged.txt");
    await rm(join(workspace, "doomed.txt"));

    const handler = createWorkspaceHandler({ cwd: workspace });
    const { body } = await call(handler, "/api/workspace/git/status");

    expect(body.repo).toBe(true);
    expect(body.branch).toBe("main");
    expect(body.files).toEqual({
      "committed.txt": "modified",
      "fresh.txt": "untracked",
      "staged.txt": "added",
      "doomed.txt": "deleted",
    });
  });

  it("relativizes statuses when the workspace is a repo subdirectory", async () => {
    await initRepo(workspace);
    await mkdir(join(workspace, "sub"));
    await writeFile(join(workspace, "root.txt"), "root\n");
    await writeFile(join(workspace, "sub", "inner.txt"), "v1\n");
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-m", "init");
    await writeFile(join(workspace, "root.txt"), "changed\n");
    await writeFile(join(workspace, "sub", "inner.txt"), "v2\n");

    const handler = createWorkspaceHandler({ cwd: join(workspace, "sub") });
    const { body } = await call(handler, "/api/workspace/git/status");

    // root.txt is outside the workspace and must be dropped.
    expect(body.files).toEqual({ "inner.txt": "modified" });
  });

  it("diffs modified files against HEAD and untracked files against /dev/null", async () => {
    await initRepo(workspace);
    await writeFile(join(workspace, "a.txt"), "one\n");
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-m", "init");
    await writeFile(join(workspace, "a.txt"), "two\n");
    await writeFile(join(workspace, "b.txt"), "brand new\n");

    const handler = createWorkspaceHandler({ cwd: workspace });

    const modified = await call(handler, "/api/workspace/git/diff?path=a.txt");
    expect(modified.body.diff).toContain("-one");
    expect(modified.body.diff).toContain("+two");

    const untracked = await call(handler, "/api/workspace/git/diff?path=b.txt");
    expect(untracked.body.diff).toContain("+brand new");
  });

  it("returns an empty diff for clean tracked files", async () => {
    await initRepo(workspace);
    await writeFile(join(workspace, "clean.txt"), "same\n");
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-m", "init");

    const handler = createWorkspaceHandler({ cwd: workspace });
    const { body } = await call(handler, "/api/workspace/git/diff?path=clean.txt");
    expect(body.diff).toBe("");
  });
});

describe("routing", () => {
  it("404s unknown routes and non-GET methods", async () => {
    const handler = createWorkspaceHandler({ cwd: workspace });
    expect((await call(handler, "/api/workspace/nope")).status).toBe(404);
    expect((await handler(new Request("http://localhost/api/workspace/files", { method: "POST" }))).status).toBe(404);
  });

  it("honors a custom basePath", async () => {
    const handler = createWorkspaceHandler({ cwd: workspace, basePath: "/ws" });
    expect((await call(handler, "/ws/files")).status).toBe(200);
    expect((await call(handler, "/api/workspace/files")).status).toBe(404);
  });
});
