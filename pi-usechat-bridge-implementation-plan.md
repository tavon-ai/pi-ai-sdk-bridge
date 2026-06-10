# Pi ↔ AI SDK `useChat` Bridge — Implementation Plan

Status: reviewed against AI SDK v6 sources (`packages/ai/src/ui`, `packages/ai/src/ui-message-stream`)
and Pi sources (`packages/agent/src/types.ts`, `packages/coding-agent/docs/sdk.md`) on 2026-06-10.
Supersedes the architecture sketch in `pi-usechat-bridge-plan.md` (which remains valid; this adds
corrections and execution detail).

## Verdict on the original idea

The core architecture is correct and verified:

- `HttpChatTransport.sendMessages()` POSTs `{ id, messages, trigger, messageId, ...body }` and
  parses the response as an SSE stream of `UIMessageChunk` (`http-chat-transport.ts`,
  `default-chat-transport.ts`). A server that emits valid chunks is a fully compatible backend —
  no client-side changes, no `useChat` fork.
- `reconnectToStream()` does `GET {api}/{chatId}/stream` and treats HTTP 204 as "nothing to
  resume" (`http-chat-transport.ts:253`). Returning 204 initially is exactly right, and it is only
  called when the app uses `resumeStream()`.
- Pi's `AgentSession.subscribe()` event stream (`AgentSessionEvent` + `AssistantMessageEvent`)
  contains everything needed for the mapping, including streaming tool output
  (`tool_execution_update`).
- Server-owned history (chatId → `AgentSession`, ignore the client's message array except the
  last user message) is the right session model.

## Corrections and changes to the original plan

### 1. Repo placement

The bridge lives in its own repo: **`tavon-ai/pi-ai-sdk-bridge`** (npm:
`@tavon-ai/pi-ai-sdk-bridge`). Not in `vercel/ai` (the whole point is that the AI SDK needs
zero changes) and not in `pi-mono` (pi auto-closes new-contributor PRs; independent release
cadence is cleaner anyway). It consumes only public, documented APIs:
`@earendil-works/pi-coding-agent` (SDK exports, pinned exact version) and the published `ai`
package v6 (chunk types + stream helpers, `^6` peer dependency).

Consequences of standing alone:

- Version drift surfaces post-release instead of in-repo. Tripwires: validate every emitted
  chunk against `uiMessageChunkSchema` in CI (M1), plus a scheduled CI job running the suite
  against `pi-coding-agent@latest`.
- No access to pi-mono test internals — own recorded fixtures (planned in M1).
- README must state clearly this is a third-party bridge, not an official pi or Vercel package.

### 2. Map Pi turns to AI SDK steps (missing in v1 plan)

One `useChat` assistant message spans the entire agent run (multiple LLM turns + tool calls).
The AI SDK protocol expresses turn boundaries as `start-step` / `finish-step`, which become
`step-start` parts that AI Elements renders between tool loops. Without them, multi-turn runs
render as one undifferentiated blob.

Corrected lifecycle mapping:

| Pi event | AI SDK `UIMessageChunk` |
|---|---|
| `agent_start` | `start` (with generated `messageId`) |
| `turn_start` | `start-step` |
| `message_update` / `text_start` | `text-start` |
| `message_update` / `text_delta` | `text-delta` |
| `message_update` / `text_end` | `text-end` |
| `message_update` / `thinking_start` | `reasoning-start` |
| `message_update` / `thinking_delta` | `reasoning-delta` |
| `message_update` / `thinking_end` | `reasoning-end` |
| `message_update` / `toolcall_start` | `tool-input-start` (`dynamic: true`) |
| `message_update` / `toolcall_delta` | `tool-input-delta` |
| `message_update` / `toolcall_end` | `tool-input-available` (`dynamic: true`) |
| `tool_execution_update` | `tool-output-available` with `preliminary: true` |
| `tool_execution_end` (ok) | `tool-output-available` |
| `tool_execution_end` (isError) | `tool-output-error` |
| `turn_end` | `finish-step` |
| `agent_end` | `finish` (+ `finishReason`) |
| error | `error` then stream close |
| abort | `abort` |

Notes:

- `tool_execution_update` → `preliminary: true` outputs is a verified protocol feature
  (`ui-message-chunks.ts`, `preliminary?: boolean`) and gives live-streaming bash output in the
  UI for free. The v1 plan missed this.
- `tool_execution_start` needs no chunk (input is already available); optionally emit a
  transient `data-pi-tool-status` part later.

### 3. Emit tool chunks with `dynamic: true`

Typed tool parts (`tool-${name}`) require the client's `UIMessage` generic to know the tool
schemas at compile time. Pi's tool set is server-defined and open-ended (extensions, custom
tools). Setting `dynamic: true` on `tool-input-*` chunks makes the client produce
`dynamic-tool` parts (`process-ui-message-stream.ts:333`), which `useChat` and AI Elements
handle without any client-side tool typing. Use it for all Pi tools.

### 4. Part IDs must be allocated by the bridge

Pi's `AssistantMessageEvent`s are keyed by `contentIndex`; AI SDK chunks need stable string
`id`s per part (and `toolCallId` for tools, which Pi provides on `toolcall_end` /
`tool_execution_*`). The converter must maintain a per-run map
`(messageOrdinal, contentIndex) → partId` (e.g. `msg_{n}_{contentIndex}`). For
`toolcall_start`/`toolcall_delta` the `toolCallId` and `toolName` are available on
`partial.content[contentIndex]` and must be read from there.

### 5. Initial history load (missing in v1 plan)

The v1 plan never says how a client renders an existing session after a page reload — `useChat`
starts from the `messages` you give it. Add:

- `GET /api/chat/:id` → `UIMessage[]` (convert Pi `AgentMessage[]` → UI messages, the inverse
  converter; tool results fold into the owning assistant message's tool parts)
- Client: fetch before mount, pass as `messages` to `useChat`.

This converter is also what makes `DELETE`, session lists, and server restarts workable.

### 6. Concurrent sends and steering

`Chat.makeRequest` has no guard against a second `sendMessage()` while streaming — it would
replace `activeResponse` client-side while the server-side Pi session is still streaming (and
Pi's `prompt()` throws without `streamingBehavior`). Plan explicitly:

- M1 demo: disable submit while `status !== 'ready'` (standard pattern).
- M3: support steering — request body flag `pi: { streamingBehavior: 'steer' | 'followUp' }`;
  the handler calls `session.steer()/followUp()` and returns 202 with no stream (the output
  arrives on the already-open stream of the first request).

### 7. Tool output shape

Pi `ToolResultMessage` is `{ content: (Text|Image)[], details?, isError }`. Map
`output` to `{ content, details }` passthrough (drop or data-URL-encode images initially).
AI Elements' `Tool` component renders `output` as JSON; richer rendering comes via
`data-pi-*` parts in M3, not by reshaping the tool output.

### 8. Abort wiring

Two directions, both needed:

- Client → server: `stop()` aborts the HTTP request; the handler must hook
  `request.signal.addEventListener('abort', () => session.abort())`.
- Pi → client: Pi-side aborts (e.g. another actor steering the session) emit the `abort` chunk
  so `useChat` status resolves cleanly.

### 9. Stop reason mapping (small correction)

`FinishReason` is `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'`
(`packages/ai/src/types/language-model.ts:75`). Map Pi `aborted` → emit `abort` chunk (no
`finish` needed; the client finalizes on abort). `toolUse` never terminates a run in practice
(the harness continues the loop), so `finish.finishReason` is effectively
`stop | length | error`.

### 10. Security framing

Pi has **no built-in permission system** (pi-mono README) — a remote bridge is remote code
execution on the host by design. The v1 plan's control list is right; add as a hard rule:
the bridge process itself must run inside the isolation boundary (container/VM per
user or per workspace, see `packages/coding-agent/docs/containerization.md`), not in front
of it. Auth before streaming, deny-by-default CORS, and no public unauthenticated deployment
even for demos.

## Package design

Repo layout (pnpm workspace in `tavon-ai/pi-ai-sdk-bridge`):

```
packages/bridge/                     # @tavon-ai/pi-ai-sdk-bridge
  src/
    convert/
      pi-events-to-ui-chunks.ts      # pure: AsyncIterable<AgentSessionEvent> → UIMessageChunk stream state machine
      pi-messages-to-ui-messages.ts  # history: AgentMessage[] → UIMessage[]
      ui-message-to-pi-prompt.ts     # last user UIMessage → { text, images: ImageContent[] }
    server/
      chat-session-store.ts          # chatId → AgentSession (+ idle eviction, dispose)
      create-chat-handler.ts         # (Request) → Response, fetch-style; works in Hono/Next/Bun/Node(via adapter)
    cli.ts                           # thin entry point: parse args → createPiChatHandler → Hono server
    index.ts
  test/
    fixtures/                        # recorded Pi event sequences (JSON)
    *.test.ts
examples/
  chat/                              # Vite/Next demo app (M2/M3), workspace package, not published
```

The package ships a `pi-bridge` bin entry (declared in `package.json#bin`) so both of these work out of the box:

```bash
# one-shot, no install
npx @tavon-ai/pi-ai-sdk-bridge --cwd /path/to/project --port 3001

# global install
npm install -g @tavon-ai/pi-ai-sdk-bridge
pi-bridge --cwd /path/to/project --tools read,bash,edit,write
```

`cli.ts` is a thin wrapper (~40 lines): parse CLI args with a lightweight parser, call `createPiChatHandler()`, start the bundled Hono server. The programmatic API remains first-class; the CLI is just convenience over it.

Design rules:

- The converter is a **pure state machine** (events in, chunks out, no I/O) — unit-testable
  against fixture event sequences, snapshot the chunk output.
- The handler composes AI SDK helpers: `createUIMessageStream` (writer),
  `createUIMessageStreamResponse` / `JsonToSseTransformStream` (SSE framing + protocol headers).
  Don't hand-roll SSE.
- Fetch-style `(Request) => Response` handler keeps it framework-agnostic; ship a tiny Hono
  server as the reference deployment.

HTTP surface:

```
POST   /api/chat              # submit-message → SSE UIMessageChunk stream
GET    /api/chat/:id          # UIMessage[] history (M2)
GET    /api/chat/:id/stream   # 204 (M2); live resume (M4)
DELETE /api/chat/:id          # dispose + delete (M2)
```

## Milestones

### M0 — Spike: text streams end to end (≈1 day)

Goal: prove the protocol match with the least code.

- Hono server, single hardcoded session config (`SessionManager.inMemory()`, fixed model, fixed
  cwd, `tools: []`), text + reasoning chunks only, ignore tools.
- Vanilla `useChat` + `DefaultChatTransport` page; input disabled while streaming.
- Abort wiring (request signal → `session.abort()`).

Accept: streamed assistant text and thinking render in the browser; `stop()` works; `status`
transitions `submitted → streaming → ready`.

### M1 — Full event converter (≈2–3 days)

Goal: the conversion layer is complete and tested.

- Implement `pi-events-to-ui-chunks` per the corrected mapping table: steps, tools
  (`dynamic: true`), preliminary tool outputs, error, abort, finishReason; part-ID allocation.
- Implement `ui-message-to-pi-prompt` (text parts + file parts with image media types →
  `ImageContent` base64).
- Fixture-based unit tests: record real Pi event sequences (text-only run, multi-turn tool run,
  error, abort) into `test/fixtures/`, snapshot the emitted chunk sequences. Validate every
  emitted chunk against the AI SDK's `uiMessageChunkSchema` in tests so protocol drift fails CI.

Accept: tool calls from a real Pi run render in the client as dynamic tool parts with live
(preliminary) output; converter test suite green with schema validation.

### M2 — Session lifecycle + standalone CLI (≈2–3 days)

Goal: chats survive reloads and idle time; zero-code usage via CLI.

- `ChatSessionStore`: chatId → session; lazy create on first POST; idle timer → `dispose()`;
  re-open persisted sessions (`SessionManager.open`) on cache miss; cap concurrent sessions.
- Map chatId → session file path deterministically (chatId allowlist charset; no path traversal).
- `GET /api/chat/:id` history endpoint + `pi-messages-to-ui-messages` converter;
  `DELETE /api/chat/:id`; `GET /api/chat/:id/stream` → 204.
- Reject `trigger: 'regenerate-message'` with a clear error chunk (graceful UI failure, not a
  broken fetch).
- Concurrency guard: 409 if the session is streaming (until M3 steering).
- `cli.ts` + `package.json#bin`: `pi-bridge --cwd <dir> [--port 3001] [--tools read,bash,...]`
  starts the bridge as a standalone server with no user code required. Supports `npx` usage.

Accept: reload a chat mid-conversation and continue it; two chats run independently; killing
the server and restarting restores history from session files; `npx @tavon-ai/pi-ai-sdk-bridge --cwd .` starts a working bridge server.

### M3 — AI Elements demo + Pi-specific UX (≈3–5 days)

Goal: a credible coding-agent web UI.

- Demo app using AI Elements: `Conversation`, `Message`, `Reasoning`, `Tool` (dynamic parts),
  `PromptInput`.
- Steering/follow-up: `pi.streamingBehavior` body flag → `steer()/followUp()`, 202 response;
  enable input while streaming in the demo.
- Transient `data-pi-*` parts for session state: compaction start/end, model switch, queue
  state, session metadata (cwd, model). Custom renderers in the demo.
- Per-chat config on first POST (`pi: { cwd, model, tools }`) — validated server-side against
  an allowlist; ignored on subsequent posts.

Accept: demo renders a multi-tool coding session legibly (live bash output, edit summaries via
tool `details`); user can steer a running session from the UI.

### M4 — Regenerate + stream resume (≈3–5 days)

Goal: full `useChat` surface.

- Regenerate: on `trigger: 'regenerate-message'`, locate the last user entry in the session
  tree, `sessionManager.branch()` (or `runtime.fork`) to it, re-prompt with the stored user
  text, stream the new run. Note `AgentSessionRuntime` replaces `session` — re-subscribe.
- Stream resume: per-chat ring buffer of emitted chunks for the active run;
  `GET /api/chat/:id/stream` replays the buffer then tails live; 204 when idle. Demo uses
  `resumeStream()` on mount.

Accept: AI Elements' regenerate action produces a new assistant answer on a branched session;
reloading mid-run reattaches to the live stream without losing earlier chunks.

### M5 — Hardening for remote deployment (ongoing)

- Bearer-token auth middleware (per-user token → workspace/cwd + tool allowlist), deny-by-default
  CORS, rate limiting, request size limits, audit log of prompts and tool executions.
- Reference deployment: bridge inside a container/VM per workspace
  (per `containerization.md`); never the bridge in front of an unsandboxed host.
- Docs: README with threat model, deployment guide, protocol-version compatibility note
  (pin `ai` peer range; chunk schema is validated in CI from M1).

## Resolved open questions (recommendations)

| Question (from v1 plan) | Recommendation |
|---|---|
| Persistent session file vs in-memory per chatId | Persistent file keyed by chatId from M2; in-memory only in M0/M1 and tests |
| Workspace authorization | Server-side allowlist bound to the auth token (M5); client `pi.cwd` is a request, not a grant |
| Model selection | Server-validated allowlist; client may request via `pi.model` (M3) |
| Real `resumeStream()` | Yes, but deferred to M4 (ring-buffer replay); 204 until then |
| Expose session tree | Only implicitly via regenerate (M4); full tree UI out of scope |
| Tool parts vs `data-pi-*` | Both: dynamic tool parts as the truthful execution record (M1), `data-pi-*` for session-level/transient state (M3) |
