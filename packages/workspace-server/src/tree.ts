import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export const DEFAULT_IGNORE = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".DS_Store",
  ".cache",
  "coverage",
];

export async function readTree(dir: string, ignore: ReadonlySet<string>, relative = ""): Promise<FileTreeNode[]> {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => !ignore.has(entry.name) && !entry.isSymbolicLink())
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path, type: "directory", children: await readTree(join(dir, entry.name), ignore, path) });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path, type: "file" });
    }
  }
  return nodes;
}
