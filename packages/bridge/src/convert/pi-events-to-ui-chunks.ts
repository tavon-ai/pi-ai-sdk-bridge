import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UIMessageChunk } from "ai";

export interface PiEventsToUIChunksOptions {
  messageId?: string;
  generateMessageId?: () => string;
}

type PiAssistantMessage = {
  role: "assistant";
  content?: Array<unknown>;
  stopReason?: string;
  errorMessage?: string;
};

type PiToolCall = {
  type: "toolCall";
  id?: string;
  name?: string;
  arguments?: unknown;
};

export async function* piEventsToUIChunks(
  events: AsyncIterable<AgentSessionEvent>,
  options: PiEventsToUIChunksOptions = {},
): AsyncGenerator<UIMessageChunk> {
  const state = new ConverterState(options);

  try {
    for await (const event of events) {
      for (const chunk of state.convert(event)) {
        yield chunk;
      }
    }
  } catch (error) {
    yield { type: "error", errorText: getErrorMessage(error) };
  }
}

class ConverterState {
  private readonly messageId: string;
  private assistantOrdinal = 0;
  private currentAssistantOrdinal = 0;
  private finished = false;
  private aborted = false;
  private errored = false;

  constructor(options: PiEventsToUIChunksOptions) {
    this.messageId = options.messageId ?? options.generateMessageId?.() ?? `pi_${Date.now().toString(36)}`;
  }

  *convert(event: AgentSessionEvent): Generator<UIMessageChunk> {
    if (this.finished) return;

    switch (event.type) {
      case "agent_start":
        this.aborted = false;
        this.errored = false;
        yield { type: "start", messageId: this.messageId };
        break;

      case "turn_start":
        yield { type: "start-step" };
        break;

      case "turn_end":
        yield { type: "finish-step" };
        break;

      case "message_start":
        if (isAssistantMessage(event.message)) {
          this.assistantOrdinal += 1;
          this.currentAssistantOrdinal = this.assistantOrdinal;
        }
        break;

      case "message_update":
        yield* this.convertAssistantMessageEvent(event.assistantMessageEvent);
        break;

      case "tool_execution_update":
        yield {
          type: "tool-output-available",
          toolCallId: event.toolCallId,
          output: toToolOutput(event.partialResult),
          dynamic: true,
          preliminary: true,
        };
        break;

      case "tool_execution_end":
        if (event.isError) {
          yield {
            type: "tool-output-error",
            toolCallId: event.toolCallId,
            errorText: toolErrorText(event.result),
            dynamic: true,
          };
        } else {
          yield {
            type: "tool-output-available",
            toolCallId: event.toolCallId,
            output: toToolOutput(event.result),
            dynamic: true,
          };
        }
        break;

      case "agent_end": {
        if (event.willRetry) break;
        const assistant = lastAssistantMessage(event.messages);
        const stopReason = assistant?.stopReason;
        if (stopReason === "aborted") {
          this.aborted = true;
          this.finished = true;
          yield { type: "abort", reason: assistant?.errorMessage };
        } else {
          this.finished = true;
          yield { type: "finish", finishReason: mapFinishReason(stopReason) };
        }
        break;
      }

      case "compaction_start":
      case "compaction_end":
      case "queue_update":
      case "auto_retry_start":
      case "auto_retry_end":
      case "session_info_changed":
      case "thinking_level_changed":
      case "tool_execution_start":
      case "message_end":
        break;

      default:
        assertNever(event);
    }
  }

  private *convertAssistantMessageEvent(event: AgentSessionEventForMessageUpdate): Generator<UIMessageChunk> {
    switch (event.type) {
      case "start":
        break;

      case "text_start":
        yield { type: "text-start", id: this.partId(event.contentIndex) };
        break;

      case "text_delta":
        yield { type: "text-delta", id: this.partId(event.contentIndex), delta: event.delta };
        break;

      case "text_end":
        yield { type: "text-end", id: this.partId(event.contentIndex) };
        break;

      case "thinking_start":
        yield { type: "reasoning-start", id: this.partId(event.contentIndex) };
        break;

      case "thinking_delta":
        yield { type: "reasoning-delta", id: this.partId(event.contentIndex), delta: event.delta };
        break;

      case "thinking_end":
        yield { type: "reasoning-end", id: this.partId(event.contentIndex) };
        break;

      case "toolcall_start": {
        const tool = toolCallAt(event.partial, event.contentIndex);
        yield {
          type: "tool-input-start",
          toolCallId: tool.id ?? this.syntheticToolCallId(event.contentIndex),
          toolName: tool.name ?? "unknown",
          dynamic: true,
        };
        break;
      }

      case "toolcall_delta": {
        const tool = toolCallAt(event.partial, event.contentIndex);
        yield {
          type: "tool-input-delta",
          toolCallId: tool.id ?? this.syntheticToolCallId(event.contentIndex),
          inputTextDelta: event.delta,
        };
        break;
      }

      case "toolcall_end":
        yield {
          type: "tool-input-available",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
          input: event.toolCall.arguments ?? {},
          dynamic: true,
        };
        break;

      case "done":
        break;

      case "error":
        if (event.reason === "aborted") {
          this.aborted = true;
          this.finished = true;
          yield { type: "abort", reason: event.error.errorMessage };
        } else {
          this.errored = true;
          yield { type: "error", errorText: event.error.errorMessage ?? "Pi agent error" };
        }
        break;

      default:
        assertNever(event);
    }
  }

  private partId(contentIndex: number): string {
    return `msg_${this.currentAssistantOrdinal}_${contentIndex}`;
  }

  private syntheticToolCallId(contentIndex: number): string {
    return `tool_${this.currentAssistantOrdinal}_${contentIndex}`;
  }
}

type AgentSessionEventForMessageUpdate = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];

function isAssistantMessage(message: unknown): message is PiAssistantMessage {
  return typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant";
}

function lastAssistantMessage(messages: readonly unknown[]): PiAssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (isAssistantMessage(message)) return message;
  }
  return undefined;
}

function toolCallAt(partial: PiAssistantMessage, contentIndex: number): PiToolCall {
  const block = partial.content?.[contentIndex];
  if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === "toolCall") {
    return block as PiToolCall;
  }
  return { type: "toolCall" };
}

function toToolOutput(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result;
  const value = result as { content?: unknown; details?: unknown };
  return {
    content: normalizeContent(value.content),
    details: value.details,
  };
}

function normalizeContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (typeof part !== "object" || part === null) return part;
    const value = part as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
    if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
      return { type: "image", mediaType: value.mimeType, url: `data:${value.mimeType};base64,${value.data}` };
    }
    return part;
  });
}

function toolErrorText(result: unknown): string {
  const output = toToolOutput(result);
  if (typeof output === "object" && output !== null) {
    const content = (output as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }
  return "Tool execution failed";
}

function mapFinishReason(stopReason: string | undefined): UIMessageChunk & { type: "finish" } extends infer T
  ? T extends { finishReason?: infer R }
    ? R
    : never
  : never {
  switch (stopReason) {
    case "length":
      return "length" as never;
    case "error":
      return "error" as never;
    case "toolUse":
      return "tool-calls" as never;
    case "stop":
    case undefined:
      return "stop" as never;
    default:
      return "other" as never;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Pi event: ${JSON.stringify(value)}`);
}
