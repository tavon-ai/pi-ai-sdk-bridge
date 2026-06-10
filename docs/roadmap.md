# Roadmap / Implementation Status

Completed against [`implementation-plan.md`](implementation-plan.md):

## Repo/package setup

- ✅ Standalone package structure under `packages/bridge`
- ✅ npm package name: `@tavon-ai/pi-ai-sdk-bridge`
- ✅ pinned Pi dependency: `@earendil-works/pi-coding-agent@0.79.0`
- ✅ AI SDK v6 peer dependency: `ai: ^6.0.0`
- ✅ `pi-bridge` bin entry
- ✅ pnpm workspace setup

## Converter layer

- ✅ `pi-events-to-ui-chunks.ts`
  - `agent_start` → `start`
  - `turn_start` / `turn_end` → `start-step` / `finish-step`
  - text streaming chunks
  - reasoning streaming chunks
  - dynamic tool input chunks with `dynamic: true`
  - preliminary tool output chunks
  - final tool output/error chunks
  - `agent_end` → `finish`
  - aborted/error handling
  - part id allocation like `msg_{n}_{contentIndex}`
- ✅ `ui-message-to-pi-prompt.ts`
  - converts last user `UIMessage` text parts
  - converts image file data URLs to Pi image content
- ✅ `pi-messages-to-ui-messages.ts`
  - basic Pi history → AI SDK `UIMessage[]`
  - folds tool results into dynamic tool parts

## Server/API

- ✅ `createPiChatHandler()`
  - fetch-style `(Request) => Response`
  - `POST /api/chat`
  - `GET /api/chat/:id`
  - `GET /api/chat/:id/stream` → `204`
  - `DELETE /api/chat/:id`
- ✅ Uses AI SDK `createUIMessageStream` / `createUIMessageStreamResponse`
- ✅ Abort wiring: request abort calls `session.abort()`
- ✅ Rejects concurrent sends with `409`
- ✅ Basic steering/follow-up support if request body includes `pi.streamingBehavior`
- ✅ Rejects regenerate with graceful error stream

## Session store

- ✅ `ChatSessionStore`
  - chatId → `AgentSession`
  - lazy create
  - idle eviction
  - max session cap
  - chatId charset validation

## CLI

- ✅ `pi-bridge`
  - `--cwd`
  - `--port`
  - `--host`
  - `--tools`
  - `--base-path`
- ✅ Hono-based standalone server

## Tests

- ✅ Fixture-style converter tests started
- ✅ validates chunks against AI SDK `uiMessageChunkSchema`
- ✅ text/reasoning test
- ✅ dynamic tool/preliminary output test

## Still incomplete from the plan

- ❌ Persistent session files keyed by chatId
- ❌ Re-open persisted sessions on restart
- ❌ Full real Pi-recorded fixtures
- ✅ AI Elements demo app (`examples/chat`)
- ❌ richer `data-pi-*` session events
- ❌ real stream resume/ring buffer
- ❌ regenerate/branching support
- ❌ auth/CORS/rate limiting hardening
- ❌ scheduled CI against latest Pi
- ❌ full deployment/security docs