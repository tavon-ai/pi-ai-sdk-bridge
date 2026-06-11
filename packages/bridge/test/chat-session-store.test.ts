import { describe, expect, it } from "vitest";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { assertSafeChatId, resolveModel, type ResolvedModel } from "../src/server/chat-session-store.js";

function registryWith(models: Array<{ provider: string; id: string }>): ModelRegistry {
  return { getAll: () => models as unknown as ResolvedModel[] } as unknown as ModelRegistry;
}

const registry = registryWith([
  { provider: "anthropic", id: "claude-opus-4-8" },
  { provider: "anthropic", id: "claude-sonnet-4-6" },
  { provider: "openai", id: "gpt-5.4" },
]);

describe("resolveModel", () => {
  it("returns undefined when nothing is configured", () => {
    expect(resolveModel(registry)).toBeUndefined();
  });

  it("resolves exact provider + model id", () => {
    const model = resolveModel(registry, "anthropic", "claude-opus-4-8");
    expect(model).toMatchObject({ provider: "anthropic", id: "claude-opus-4-8" });
  });

  it("resolves provider/id pattern without explicit provider", () => {
    const model = resolveModel(registry, undefined, "openai/gpt-5.4");
    expect(model).toMatchObject({ provider: "openai", id: "gpt-5.4" });
  });

  it("resolves a unique substring", () => {
    const model = resolveModel(registry, undefined, "sonnet");
    expect(model).toMatchObject({ id: "claude-sonnet-4-6" });
  });

  it("falls back to the provider's first model when no model is given", () => {
    const model = resolveModel(registry, "openai");
    expect(model).toMatchObject({ provider: "openai", id: "gpt-5.4" });
  });

  it("throws on ambiguous substrings", () => {
    expect(() => resolveModel(registry, undefined, "claude")).toThrow(/ambiguous/);
  });

  it("throws on unknown provider or model", () => {
    expect(() => resolveModel(registry, "nope")).toThrow(/Unknown provider/);
    expect(() => resolveModel(registry, "anthropic", "nope")).toThrow(/not found/);
  });
});

describe("assertSafeChatId", () => {
  it("accepts AI SDK style ids", () => {
    expect(() => assertSafeChatId("Tt0RFcbamZQlNDQB")).not.toThrow();
    expect(() => assertSafeChatId("a")).not.toThrow();
    expect(() => assertSafeChatId("chat_1-2")).not.toThrow();
  });

  it("rejects ids that are not valid Pi session ids", () => {
    expect(() => assertSafeChatId("-leading")).toThrow();
    expect(() => assertSafeChatId("trailing_")).toThrow();
    expect(() => assertSafeChatId("has space")).toThrow();
    expect(() => assertSafeChatId("a".repeat(129))).toThrow();
    expect(() => assertSafeChatId("")).toThrow();
  });
});
