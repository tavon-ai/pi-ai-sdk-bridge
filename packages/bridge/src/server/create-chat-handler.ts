import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from "ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { piEventsToUIChunks } from "../convert/pi-events-to-ui-chunks.js";
import { getLastUserMessage, uiMessageToPiPrompt } from "../convert/ui-message-to-pi-prompt.js";
import { piMessagesToUIMessages } from "../convert/pi-messages-to-ui-messages.js";
import { AsyncQueue } from "./async-queue.js";
import { assertSafeChatId, ChatSessionStore, type ChatSessionStoreOptions } from "./chat-session-store.js";

export interface CreatePiChatHandlerOptions extends ChatSessionStoreOptions {
  basePath?: string;
  store?: ChatSessionStore;
}

type ChatRequestBody = {
  id?: string;
  messages?: UIMessage[];
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
  pi?: {
    streamingBehavior?: "steer" | "followUp";
  };
};

export function createPiChatHandler(options: CreatePiChatHandlerOptions = {}): (request: Request) => Promise<Response> {
  const basePath = normalizeBasePath(options.basePath ?? "/api/chat");
  const store = options.store ?? new ChatSessionStore(options);

  return async function handlePiChat(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = stripTrailingSlash(url.pathname);

    try {
      if (request.method === "POST" && path === basePath) return handlePost(request, store);

      const streamMatch = path.match(new RegExp(`^${escapeRegExp(basePath)}/([^/]+)/stream$`));
      if (request.method === "GET" && streamMatch?.[1]) return new Response(null, { status: 204 });

      const chatMatch = path.match(new RegExp(`^${escapeRegExp(basePath)}/([^/]+)$`));
      if (chatMatch?.[1]) {
        const chatId = decodeURIComponent(chatMatch[1]);
        if (request.method === "GET") return handleGet(chatId, store);
        if (request.method === "DELETE") return handleDelete(chatId, store);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: getErrorMessage(error) }, 400);
    }
  };
}

async function handlePost(request: Request, store: ChatSessionStore): Promise<Response> {
  const body = (await request.json()) as ChatRequestBody;
  const chatId = body.id;
  if (!chatId) return json({ error: "Missing chat id" }, 400);
  assertSafeChatId(chatId);

  if (body.trigger === "regenerate-message") {
    return errorStream("Regenerate is not implemented yet by pi-ai-sdk-bridge.");
  }

  if (!Array.isArray(body.messages)) return json({ error: "Missing messages array" }, 400);
  const userMessage = getLastUserMessage(body.messages);
  const prompt = uiMessageToPiPrompt(userMessage);
  const record = await store.getOrCreate(chatId);

  if (record.session.isStreaming) {
    const behavior = body.pi?.streamingBehavior;
    if (behavior) {
      await record.session.prompt(prompt.text, { images: prompt.images, streamingBehavior: behavior, source: "rpc" });
      return new Response(null, { status: 202 });
    }
    return json({ error: "Session is already streaming" }, 409);
  }

  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      const queue = new AsyncQueue<AgentSessionEvent>();
      const unsubscribe = record.session.subscribe((event) => queue.push(event));
      const abort = () => void record.session.abort();
      request.signal.addEventListener("abort", abort, { once: true });

      const promptPromise = record.session
        .prompt(prompt.text, { images: prompt.images, source: "rpc" })
        .then(() => queue.close())
        .catch((error) => queue.fail(error));

      try {
        for await (const chunk of piEventsToUIChunks(queue, { messageId: body.messageId })) {
          writer.write(chunk);
        }
        await promptPromise.catch(() => undefined);
      } finally {
        request.signal.removeEventListener("abort", abort);
        unsubscribe();
      }
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
}

async function handleGet(chatId: string, store: ChatSessionStore): Promise<Response> {
  const record = await store.get(chatId);
  return json(record ? piMessagesToUIMessages(record.session.messages as never[]) : []);
}

async function handleDelete(chatId: string, store: ChatSessionStore): Promise<Response> {
  const deleted = store.delete(chatId);
  return json({ deleted });
}

function errorStream(message: string): Response {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: `pi_error_${Date.now().toString(36)}` },
    { type: "error", errorText: message },
    { type: "finish", finishReason: "error" },
  ];
  const stream = createUIMessageStream<UIMessage>({
    execute: ({ writer }) => {
      for (const chunk of chunks) writer.write(chunk);
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeBasePath(basePath: string): string {
  return stripTrailingSlash(basePath.startsWith("/") ? basePath : `/${basePath}`);
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
