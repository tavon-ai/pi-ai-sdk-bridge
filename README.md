# pi-ai-sdk-bridge

Third-party bridge from [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) `AgentSession` streams to Vercel AI SDK v6 `useChat` UI message streams.

> This is not an official Pi or Vercel package. Running Pi tools behind an HTTP API is remote code execution on the bridge host; run it inside your isolation boundary and do not expose it unauthenticated.

## Current status

Initial implementation in `packages/bridge`:

- `POST /api/chat` streams AI SDK `UIMessageChunk` SSE responses from Pi sessions.
- `GET /api/chat/:id` returns converted in-memory session history.
- `GET /api/chat/:id/stream` returns `204` (resume not implemented yet).
- `DELETE /api/chat/:id` disposes an in-memory session.
- `pi-bridge` CLI starts a Hono/Node server.

## Development

```bash
pnpm install
pnpm build
```

## Local demo app

After installing/building from the repo root, run the demo commands from the example app directory:

```bash
cd examples/web-ui-ai-elements
```

Terminal 1:

```bash
pnpm bridge
```

Terminal 2:

```bash
pnpm dev
```

The Vite app proxies `/api/chat` to the bridge, so no CORS setup is needed. Open <http://127.0.0.1:5173>. Make sure Pi has model auth configured first, for example via `ANTHROPIC_API_KEY` or an existing `pi /login` setup.

Client transport example:

```ts
import { DefaultChatTransport } from 'ai';

const transport = new DefaultChatTransport({ api: 'http://localhost:3001/api/chat' });
```
