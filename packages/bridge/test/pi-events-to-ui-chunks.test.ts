import { describe, expect, it } from "vitest";
import { uiMessageChunkSchema } from "ai";
import { piEventsToUIChunks } from "../src/convert/pi-events-to-ui-chunks.js";

const assistantBase = {
  role: "assistant",
  api: "anthropic-messages",
  provider: "anthropic",
  model: "test",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  timestamp: 0,
};

describe("piEventsToUIChunks", () => {
  it("converts text and reasoning events to valid UI chunks", async () => {
    const message = { ...assistantBase, content: [{ type: "thinking", thinking: "h" }, { type: "text", text: "hi" }], stopReason: "stop" };
    const chunks = await collect(
      piEventsToUIChunks(
        fromArray([
          { type: "agent_start" },
          { type: "turn_start" },
          { type: "message_start", message },
          { type: "message_update", message, assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "h", partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "h", partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "text_start", contentIndex: 1, partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "hi", partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "text_end", contentIndex: 1, content: "hi", partial: message } },
          { type: "turn_end", message, toolResults: [] },
          { type: "agent_end", messages: [message], willRetry: false },
        ] as never[]),
        { messageId: "assistant-1" },
      ),
    );

    expect(chunks).toMatchInlineSnapshot(`
      [
        {
          "messageId": "assistant-1",
          "type": "start",
        },
        {
          "type": "start-step",
        },
        {
          "id": "msg_1_0",
          "type": "reasoning-start",
        },
        {
          "delta": "h",
          "id": "msg_1_0",
          "type": "reasoning-delta",
        },
        {
          "id": "msg_1_0",
          "type": "reasoning-end",
        },
        {
          "id": "msg_1_1",
          "type": "text-start",
        },
        {
          "delta": "hi",
          "id": "msg_1_1",
          "type": "text-delta",
        },
        {
          "id": "msg_1_1",
          "type": "text-end",
        },
        {
          "type": "finish-step",
        },
        {
          "finishReason": "stop",
          "type": "finish",
        },
      ]
    `);
    await expectValidChunks(chunks);
  });

  it("converts dynamic tool input and preliminary output", async () => {
    const toolCall = { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } };
    const message = { ...assistantBase, content: [toolCall], stopReason: "stop" };
    const chunks = await collect(
      piEventsToUIChunks(
        fromArray([
          { type: "agent_start" },
          { type: "message_start", message },
          { type: "message_update", message, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"command":"pwd"}', partial: message } },
          { type: "message_update", message, assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall, partial: message } },
          { type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" }, partialResult: { content: [{ type: "text", text: "/tmp" }], details: { code: 0 } } },
          { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "/tmp" }], details: { code: 0 } }, isError: false },
          { type: "agent_end", messages: [message], willRetry: false },
        ] as never[]),
        { messageId: "assistant-2" },
      ),
    );

    expect(chunks.filter((chunk) => chunk.type.startsWith("tool"))).toMatchInlineSnapshot(`
      [
        {
          "dynamic": true,
          "toolCallId": "call-1",
          "toolName": "bash",
          "type": "tool-input-start",
        },
        {
          "inputTextDelta": "{\"command\":\"pwd\"}",
          "toolCallId": "call-1",
          "type": "tool-input-delta",
        },
        {
          "dynamic": true,
          "input": {
            "command": "pwd",
          },
          "toolCallId": "call-1",
          "toolName": "bash",
          "type": "tool-input-available",
        },
        {
          "dynamic": true,
          "output": {
            "content": [
              {
                "text": "/tmp",
                "type": "text",
              },
            ],
            "details": {
              "code": 0,
            },
          },
          "preliminary": true,
          "toolCallId": "call-1",
          "type": "tool-output-available",
        },
        {
          "dynamic": true,
          "output": {
            "content": [
              {
                "text": "/tmp",
                "type": "text",
              },
            ],
            "details": {
              "code": 0,
            },
          },
          "toolCallId": "call-1",
          "type": "tool-output-available",
        },
      ]
    `);
    await expectValidChunks(chunks);
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function* fromArray<T>(values: T[]): AsyncGenerator<T> {
  yield* values;
}

async function expectValidChunks(chunks: unknown[]): Promise<void> {
  const schema = uiMessageChunkSchema();
  for (const chunk of chunks) {
    const result = await schema.validate(chunk);
    expect(result.success, JSON.stringify(result)).toBe(true);
  }
}
