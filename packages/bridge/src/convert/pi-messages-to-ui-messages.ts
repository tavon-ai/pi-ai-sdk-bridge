import type { UIMessage } from "ai";

type PiTextContent = { type: "text"; text: string };
type PiThinkingContent = { type: "thinking"; thinking: string };
type PiImageContent = { type: "image"; data: string; mimeType: string };
type PiToolCall = { type: "toolCall"; id: string; name: string; arguments: unknown };

type PiUserMessage = { role: "user"; content: string | Array<PiTextContent | PiImageContent>; timestamp?: number };
type PiAssistantMessage = {
  role: "assistant";
  content: Array<PiTextContent | PiThinkingContent | PiToolCall>;
  timestamp?: number;
};
type PiToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<PiTextContent | PiImageContent>;
  details?: unknown;
  isError: boolean;
  timestamp?: number;
};

type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage | Record<string, unknown>;

export function piMessagesToUIMessages(messages: readonly PiMessage[]): UIMessage[] {
  const uiMessages: UIMessage[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (isUserMessage(message)) {
      uiMessages.push({ id: messageId(message, index), role: "user", parts: userParts(message.content) });
      continue;
    }

    if (isAssistantMessage(message)) {
      uiMessages.push({ id: messageId(message, index), role: "assistant", parts: assistantParts(message.content) });
      continue;
    }

    if (isToolResultMessage(message)) {
      const assistant = findAssistantWithTool(uiMessages, message.toolCallId);
      if (!assistant) continue;
      const toolPart = assistant.parts.find(
        (part) => part.type === "dynamic-tool" && part.toolCallId === message.toolCallId,
      );
      if (toolPart?.type !== "dynamic-tool") continue;
      Object.assign(
        toolPart,
        message.isError
          ? { state: "output-error", errorText: toolResultText(message), input: "input" in toolPart ? toolPart.input : undefined }
          : { state: "output-available", output: { content: normalizeContent(message.content), details: message.details } },
      );
    }
  }

  return uiMessages;
}

function userParts(content: PiUserMessage["content"]): UIMessage["parts"] {
  if (typeof content === "string") return [{ type: "text", text: content, state: "done" }];
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text, state: "done" };
    return { type: "file", mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` };
  });
}

function assistantParts(content: PiAssistantMessage["content"]): UIMessage["parts"] {
  return content.map((part) => {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text, state: "done" };
      case "thinking":
        return { type: "reasoning", text: part.thinking, state: "done" };
      case "toolCall":
        return {
          type: "dynamic-tool",
          toolName: part.name,
          toolCallId: part.id,
          state: "input-available",
          input: part.arguments ?? {},
        };
    }
  });
}

function findAssistantWithTool(messages: readonly UIMessage[], toolCallId: string): UIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "assistant" && message.parts.some((part) => part.type === "dynamic-tool" && part.toolCallId === toolCallId)) {
      return message;
    }
  }
  return undefined;
}

function normalizeContent(content: Array<PiTextContent | PiImageContent>): unknown[] {
  return content.map((part) =>
    part.type === "image" ? { type: "image", mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` } : part,
  );
}

function toolResultText(message: PiToolResultMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : `[${part.mimeType} image]`))
    .filter(Boolean)
    .join("\n");
}

function messageId(message: { timestamp?: number }, index: number): string {
  return `pi_history_${message.timestamp ?? index}_${index}`;
}

function isUserMessage(message: unknown): message is PiUserMessage {
  return hasRole(message, "user") && "content" in message;
}

function isAssistantMessage(message: unknown): message is PiAssistantMessage {
  return hasRole(message, "assistant") && Array.isArray((message as { content?: unknown }).content);
}

function isToolResultMessage(message: unknown): message is PiToolResultMessage {
  return hasRole(message, "toolResult") && typeof (message as { toolCallId?: unknown }).toolCallId === "string";
}

function hasRole(message: unknown, role: string): message is Record<string, unknown> {
  return typeof message === "object" && message !== null && (message as { role?: unknown }).role === role;
}
