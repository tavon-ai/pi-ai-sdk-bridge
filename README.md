# pi-ai-sdk-bridge

A bridge from [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) `AgentSession` events to [Vercel AI SDK](https://ai-sdk.dev/) `useChat` UI message streams.

The goal is to use rich [AI Elements](https://elements.ai-sdk.dev/) for the UI while using Pi as the agent harness.

![pi-ai-sdk-bridge chat demo](docs/screenshot.png)

## What it does

`pi-ai-sdk-bridge` exposes an AI SDK-compatible chat HTTP endpoint backed by a live Pi `AgentSession`:

- `POST /api/chat` streams AI SDK UI message chunks from Pi agent events.
- `GET /api/chat/:id` returns persisted session history for a chat id.
- `DELETE /api/chat/:id` removes a stored session.

This lets a frontend use AI SDK `useChat` and AI Elements while the backend keeps Pi's agent loop, tools, session state, and streaming events.

## Demo Quick start

```sh
git clone https://github.com/tavon-ai/pi-ai-sdk-bridge.git; cd pi-ai-sdk-bridge

pnpm install
pnpm build
pnpm bridge
```

The bridge starts on <http://127.0.0.1:3001/api/chat> by default.

Then run the chat demo:

```bash
cd examples/chat
pnpm dev
```

Open <http://127.0.0.1:5173>. The Vite app proxies `/api/chat` to the bridge, so no CORS setup is needed locally.

## Starting the bridge

From this workspace, the `pnpm bridge` script runs the compiled CLI:

```json
{
  "scripts": {
    "bridge": "node packages/bridge/dist/cli.js"
  }
}
```

Equivalent CLI usage:

```bash
node packages/bridge/dist/cli.js --cwd /path/to/project --host 127.0.0.1 --port 3001 --base-path /api/chat
```

Or via npx

```bash
npx @tavon-ai/pi-ai-sdk-bridge --cwd /path/to/project --port 3001
```

Common options:

- `--cwd <dir>` — workspace directory Pi should operate in (default: current directory).
- `--port, -p <port>` — listen port (default: `3001`).
- `--host <host>` — bind hostname (default: `127.0.0.1`).
- `--tools, -t <list>` — comma-separated Pi tool allowlist.
- `--base-path <path>` — chat API base path (default: `/api/chat`).

## Frontend usage

Point AI SDK `useChat` at the bridge endpoint. The example app does this through Vite's local proxy, so the browser calls `/api/chat` and Vite forwards it to `http://127.0.0.1:3001`.

## Requirements and security

Pi needs model/auth configuration before the bridge can answer, for example an API key environment variable or an existing `pi /login` setup.

Pi tools can execute code on the bridge host. Run this bridge inside your container/VM/workspace isolation boundary and protect it with auth before exposing it beyond localhost.

## Documentation

- [`docs/roadmap.md`](docs/roadmap.md) — implementation status and remaining work.
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — protocol mapping and milestone plan.
- [`docs/examples.md`](docs/examples.md) — chat demo instructions.
- [`docs/package.md`](docs/package.md) — package/CLI notes and security warning.
