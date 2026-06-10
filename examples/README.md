# Examples

## Web UI AI Elements demo

A full chatbot demo built with [AI Elements](https://ai-sdk.dev/elements) (Vite + React + Tailwind) is available in:

```text
examples/web-ui-ai-elements
```

It uses AI SDK `useChat` with the Pi bridge API. Everything in the UI is driven by the live bridge — no mocked data:

- streaming markdown responses (`Message`/`MessageResponse`)
- collapsible reasoning blocks (`Reasoning`)
- live tool calls with input/output and status badges (`Tool`)
- image attachments (file picker or drag & drop, forwarded to Pi)
- prompt suggestions, speech input, stop button, error display
- session history hydration from `GET /api/chat/:id` (reload the page and the conversation is still there; switch sessions via `?id=<chatId>`)

The AI Elements components are vendored under `src/components/` (installed via `npx ai-elements@latest`).

### 1. Start the bridge

```sh
# cd tavon-ai/pi-ai-sdk-bridge
pnpm install
pnpm build

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
