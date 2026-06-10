# Examples

## Web UI AI Elements demo

A minimal Vite + React app is available in:

```text
examples/web-ui-ai-elements
```

It uses AI SDK `useChat` with the Pi bridge API.

### 1. Start the bridge

```sh
# cd tavon-ai/pi-ai-sdk-bridge
pnpm install
pnpm build
```

```sh
pnpm bridge
```

This starts the bridge on `http://127.0.0.1:3001/api/chat` and points Pi to the repository root.

### 2. Start the demo app

In a new terminal from `examples/web-ui-ai-elements`:

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:5173
```

The Vite app proxies `/api/chat` to `http://127.0.0.1:3001`, so no CORS setup is needed for local testing.

## Requirements

Pi needs model/auth configuration before the bridge can answer, for example:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

or an existing `pi /login` setup.

## Suggested test prompts

```text
Say hello and explain what tools you can use.
```

```text
List the files in this project.
```

```text
Read the README and summarize the package status.
```
