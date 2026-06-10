# @tavon-ai/pi-ai-sdk-bridge

Third-party bridge from [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) `AgentSession` streams to Vercel AI SDK v6 `useChat` UI message streams.

Use rich AI SDK/AI Elements chat UIs while running Pi as the agent harness.

## Start the bridge

```bash
npx @tavon-ai/pi-ai-sdk-bridge --cwd /path/to/project --port 3001
```

This starts an AI SDK-compatible chat endpoint at:

```text
http://127.0.0.1:3001/api/chat
```

Options:

- `--cwd <dir>` — workspace directory Pi should operate in (default: current directory).
- `--port, -p <port>` — listen port (default: `3001`).
- `--host <host>` — bind hostname (default: `127.0.0.1`).
- `--tools, -t <list>` — comma-separated Pi tool allowlist.
- `--base-path <path>` — chat API base path (default: `/api/chat`).

## Programmatic usage

```ts
import { serve } from "@hono/node-server";
import { createPiChatHandler } from "@tavon-ai/pi-ai-sdk-bridge";

const handler = createPiChatHandler({ cwd: "/path/to/project", basePath: "/api/chat" });

serve({
  port: 3001,
  hostname: "127.0.0.1",
  fetch: (request) => handler(request),
});
```

## Security

Pi tools can execute code on the bridge host. Run this bridge inside your container/VM/workspace isolation boundary and protect it with auth before exposing it beyond localhost.
