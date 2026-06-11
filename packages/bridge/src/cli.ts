#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { createWorkspaceHandler } from "@tavon-ai/workspace-server";
import { Hono } from "hono";
import { createPiChatHandler } from "./server/create-chat-handler.js";

interface CliOptions {
  cwd: string;
  port: number;
  host?: string;
  tools?: string[];
  basePath: string;
  workspace: boolean;
  workspaceBasePath: string;
  provider?: string;
  model?: string;
  persist: boolean;
  sessionDir?: string;
}

const options = parseCli(process.argv.slice(2));
const handler = createPiChatHandler({
  cwd: options.cwd,
  tools: options.tools,
  basePath: options.basePath,
  provider: options.provider,
  model: options.model,
  persist: options.persist,
  sessionDir: options.sessionDir,
});
const app = new Hono();

// Composition root: the chat bridge and the read-only workspace API are
// separate handlers/packages, mounted together here for convenience.
if (options.workspace) {
  const workspaceHandler = createWorkspaceHandler({ cwd: options.cwd, basePath: options.workspaceBasePath });
  app.all(`${options.workspaceBasePath}/*`, async (c) => workspaceHandler(c.req.raw));
}
app.all("/*", async (c) => handler(c.req.raw));

serve({ fetch: app.fetch, port: options.port, hostname: options.host }, (info) => {
  console.log(`pi-ai-sdk bridge listening on http://${info.address}:${info.port}${options.basePath}`);
  if (options.workspace) console.log(`workspace API: http://${info.address}:${info.port}${options.workspaceBasePath}`);
  console.log(`cwd: ${options.cwd}`);
  console.log(`tools: ${options.tools?.join(",") ?? "pi default"}`);
  if (options.provider || options.model) {
    console.log(`model: ${[options.provider, options.model].filter(Boolean).join("/")}`);
  }
  console.log(`sessions: ${options.persist ? (options.sessionDir ?? "pi default session dir") : "in-memory"}`);
});

function parseCli(args: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    port: 3001,
    host: "127.0.0.1",
    basePath: "/api/chat",
    workspace: true,
    workspaceBasePath: "/api/workspace",
    provider: process.env.PI_PROVIDER || undefined,
    model: process.env.PI_MODEL || undefined,
    persist: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--cwd":
        options.cwd = requireValue(args, ++i, arg);
        break;
      case "--port":
      case "-p":
        options.port = Number(requireValue(args, ++i, arg));
        if (!Number.isInteger(options.port) || options.port <= 0) throw new Error("--port must be a positive integer");
        break;
      case "--host":
        options.host = requireValue(args, ++i, arg);
        break;
      case "--tools":
      case "-t":
        options.tools = splitCsv(requireValue(args, ++i, arg));
        break;
      case "--base-path":
        options.basePath = requireValue(args, ++i, arg);
        break;
      case "--no-workspace":
        options.workspace = false;
        break;
      case "--workspace-base-path":
        options.workspaceBasePath = requireValue(args, ++i, arg);
        break;
      case "--provider":
        options.provider = requireValue(args, ++i, arg);
        break;
      case "--model":
      case "-m":
        options.model = requireValue(args, ++i, arg);
        break;
      case "--in-memory":
        options.persist = false;
        break;
      case "--session-dir":
        options.sessionDir = requireValue(args, ++i, arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp(): void {
  console.log(`Usage: pi-bridge [options]\n\nOptions:\n  --cwd <dir>                  Workspace directory (default: current directory)\n  --port, -p <port>            Port to listen on (default: 3001)\n  --host <host>                Hostname to bind\n  --tools, -t <list>           Comma-separated Pi tool allowlist\n  --base-path <path>           Chat API base path (default: /api/chat)\n  --no-workspace               Disable the read-only workspace API\n  --workspace-base-path <path> Workspace API base path (default: /api/workspace)\n  --provider <name>            Model provider (default: $PI_PROVIDER, else Pi settings)\n  --model, -m <id>             Model id or pattern (default: $PI_MODEL, else Pi settings)\n  --in-memory                  Do not persist chats as Pi session files\n  --session-dir <dir>          Session file directory (default: Pi per-cwd default)\n  --help, -h                   Show this help\n`);
}
