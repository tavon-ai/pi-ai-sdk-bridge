import type { UIMessage } from "ai";

export interface PiPromptInput {
  text: string;
  images: PiImageContent[];
}

export interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export function uiMessageToPiPrompt(message: UIMessage): PiPromptInput {
  if (message.role !== "user") {
    throw new Error(`Expected last message to be a user message, got ${message.role}`);
  }

  const text: string[] = [];
  const images: PiImageContent[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      text.push(part.text);
      continue;
    }

    if (part.type === "file" && part.mediaType.startsWith("image/")) {
      const data = decodeDataUrl(part.url, part.mediaType);
      if (data) images.push({ type: "image", data: data.data, mimeType: data.mimeType });
    }
  }

  return { text: text.join("\n"), images };
}

export function getLastUserMessage(messages: readonly UIMessage[]): UIMessage {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user") return message;
  }
  throw new Error("Request body did not contain a user message");
}

function decodeDataUrl(url: string, fallbackMimeType: string): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) return undefined;
  const mimeType = match[1] || fallbackMimeType;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  return {
    mimeType,
    data: isBase64 ? payload : Buffer.from(decodeURIComponent(payload), "utf8").toString("base64"),
  };
}
