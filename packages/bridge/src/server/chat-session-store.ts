import { readdirSync, rmSync } from "node:fs";
import {
  AuthStorage,
  createAgentSession,
  type AgentSession,
  ModelRegistry,
  SessionManager,
  type SessionInfo,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

// The package does not export its Model type directly; derive it from the
// options shape so resolveModel stays assignable to createAgentSession.
export type ResolvedModel = NonNullable<CreateAgentSessionOptions["model"]>;

export interface ChatSessionStoreOptions {
  cwd?: string;
  tools?: string[];
  idleTtlMs?: number;
  maxSessions?: number;
  createSessionOptions?: Partial<CreateAgentSessionOptions>;
  /**
   * Persist chats as Pi session files (survives restarts). Default: true.
   * Set false to keep everything in memory (previous behavior).
   */
  persist?: boolean;
  /** Session file directory. Default: Pi's per-cwd default (~/.pi/agent/sessions/<encoded-cwd>/). */
  sessionDir?: string;
  /** Provider name used to resolve `model` (e.g. "anthropic"). */
  provider?: string;
  /** Model id or pattern resolved against the model registry (e.g. "claude-opus-4-8"). */
  model?: string;
}

export interface ChatSessionRecord {
  id: string;
  session: AgentSession;
  lastUsedAt: number;
}

export interface ChatSummary {
  id: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: string;
  modified: string;
}

export class ChatSessionStore {
  private readonly cwd: string;
  private readonly tools: string[] | undefined;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private readonly createSessionOptions: Partial<CreateAgentSessionOptions>;
  private readonly persist: boolean;
  private readonly sessionDir: string | undefined;
  private readonly provider: string | undefined;
  private readonly modelPattern: string | undefined;
  private configuredModel: ResolvedModel | undefined | null = null;
  private readonly sessions = new Map<string, ChatSessionRecord>();
  private readonly pending = new Map<string, Promise<ChatSessionRecord>>();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = ModelRegistry.create(this.authStorage);

  constructor(options: ChatSessionStoreOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.tools = options.tools;
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60_000;
    this.maxSessions = options.maxSessions ?? 32;
    this.createSessionOptions = options.createSessionOptions ?? {};
    this.persist = options.persist ?? true;
    // SessionManager.create resolves Pi's default per-cwd session dir without
    // writing anything; the file only appears on the first assistant message.
    this.sessionDir = this.persist
      ? (options.sessionDir ?? SessionManager.create(this.cwd).getSessionDir())
      : undefined;
    this.provider = options.provider;
    this.modelPattern = options.model;
  }

  async getOrCreate(chatId: string): Promise<ChatSessionRecord> {
    assertSafeChatId(chatId);
    this.evictIdle();

    const existing = this.sessions.get(chatId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const pending = this.pending.get(chatId);
    if (pending) return pending;

    const created = this.create(chatId).finally(() => this.pending.delete(chatId));
    this.pending.set(chatId, created);
    return created;
  }

  async get(chatId: string): Promise<ChatSessionRecord | undefined> {
    assertSafeChatId(chatId);
    const existing = this.sessions.get(chatId);
    if (existing) existing.lastUsedAt = Date.now();
    return existing;
  }

  /** Like get(), but also rehydrates a persisted chat from its session file. */
  async getOrOpen(chatId: string): Promise<ChatSessionRecord | undefined> {
    assertSafeChatId(chatId);
    const existing = this.sessions.get(chatId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    if (this.persist && this.findSessionFile(chatId)) return this.getOrCreate(chatId);
    return undefined;
  }

  async list(): Promise<ChatSummary[]> {
    if (!this.persist || !this.sessionDir) {
      return [...this.sessions.values()].map((record) => inMemoryChatSummary(record));
    }
    const infos = await SessionManager.list(this.cwd, this.sessionDir);
    return infos.map((info) => persistedChatSummary(info));
  }

  delete(chatId: string): boolean {
    assertSafeChatId(chatId);
    const existing = this.sessions.get(chatId);
    if (existing) {
      existing.session.dispose();
      this.sessions.delete(chatId);
    }
    const sessionFile = this.persist ? this.findSessionFile(chatId) : undefined;
    if (sessionFile) rmSync(sessionFile, { force: true });
    return Boolean(existing) || Boolean(sessionFile);
  }

  dispose(): void {
    for (const record of this.sessions.values()) record.session.dispose();
    this.sessions.clear();
  }

  private async create(chatId: string): Promise<ChatSessionRecord> {
    if (this.sessions.size >= this.maxSessions) this.evictLeastRecentlyUsed();

    const model = this.resolveConfiguredModel();
    const { session } = await createAgentSession({
      cwd: this.cwd,
      sessionManager: this.createSessionManager(chatId),
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      tools: this.tools,
      ...(model ? { model } : {}),
      ...this.createSessionOptions,
    });

    const record = { id: chatId, session, lastUsedAt: Date.now() };
    this.sessions.set(chatId, record);
    return record;
  }

  private createSessionManager(chatId: string): SessionManager {
    if (!this.persist) return SessionManager.inMemory(this.cwd);
    const existingFile = this.findSessionFile(chatId);
    if (existingFile) return SessionManager.open(existingFile, this.sessionDir, this.cwd);
    return SessionManager.create(this.cwd, this.sessionDir, { id: chatId });
  }

  /**
   * Session files are named `<timestamp>_<sessionId>.jsonl` where the
   * timestamp contains no underscores, so everything after the first
   * underscore is the session id. Chats are persisted with sessionId = chatId.
   */
  private findSessionFile(chatId: string): string | undefined {
    if (!this.sessionDir) return undefined;
    let files: string[];
    try {
      files = readdirSync(this.sessionDir);
    } catch {
      return undefined;
    }
    const matches = files
      .filter((file) => {
        if (!file.endsWith(".jsonl")) return false;
        const separator = file.indexOf("_");
        return separator !== -1 && file.slice(separator + 1, -".jsonl".length) === chatId;
      })
      .sort();
    const latest = matches[matches.length - 1];
    return latest ? `${this.sessionDir}/${latest}` : undefined;
  }

  private resolveConfiguredModel(): ResolvedModel | undefined {
    if (this.configuredModel !== null) return this.configuredModel;
    this.configuredModel = resolveModel(this.modelRegistry, this.provider, this.modelPattern);
    return this.configuredModel;
  }

  private evictIdle(): void {
    const cutoff = Date.now() - this.idleTtlMs;
    for (const [id, record] of this.sessions) {
      if (record.lastUsedAt < cutoff && !record.session.isStreaming) this.evict(id);
    }
  }

  private evictLeastRecentlyUsed(): void {
    let oldest: ChatSessionRecord | undefined;
    for (const record of this.sessions.values()) {
      if (record.session.isStreaming) continue;
      if (!oldest || record.lastUsedAt < oldest.lastUsedAt) oldest = record;
    }
    if (!oldest) throw new Error("Maximum concurrent streaming sessions reached");
    this.evict(oldest.id);
  }

  /** Drop a session from memory without touching its session file. */
  private evict(chatId: string): void {
    const existing = this.sessions.get(chatId);
    if (!existing) return;
    existing.session.dispose();
    this.sessions.delete(chatId);
  }
}

/**
 * Resolve a provider/model selection against the registry. Matching order:
 * exact provider+id, exact id (unique across providers), then unique
 * case-insensitive id substring. Throws when the selection cannot be resolved,
 * so misconfiguration surfaces on the first chat request instead of silently
 * using the default model.
 */
export function resolveModel(
  registry: ModelRegistry,
  provider?: string,
  modelPattern?: string,
): ResolvedModel | undefined {
  if (!provider && !modelPattern) return undefined;

  const all = registry.getAll() as ResolvedModel[];
  let candidates = all;
  if (provider) {
    candidates = all.filter((model) => model.provider.toLowerCase() === provider.toLowerCase());
    if (candidates.length === 0) {
      throw new Error(`Unknown provider "${provider}". Known providers: ${[...new Set(all.map((m) => m.provider))].join(", ")}`);
    }
  }

  if (!modelPattern) return candidates[0];

  const pattern = modelPattern.toLowerCase();
  const exact = candidates.filter(
    (model) => model.id.toLowerCase() === pattern || `${model.provider}/${model.id}`.toLowerCase() === pattern,
  );
  if (exact.length >= 1) return exact[0];

  const partial = candidates.filter((model) => model.id.toLowerCase().includes(pattern));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Model "${modelPattern}" is ambiguous: ${partial.map((m) => `${m.provider}/${m.id}`).join(", ")}`,
    );
  }
  throw new Error(`Model "${modelPattern}" not found${provider ? ` for provider "${provider}"` : ""}.`);
}

function persistedChatSummary(info: SessionInfo): ChatSummary {
  return {
    id: info.id,
    name: info.name,
    firstMessage: info.firstMessage,
    messageCount: info.messageCount,
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
  };
}

function inMemoryChatSummary(record: ChatSessionRecord): ChatSummary {
  const messages = record.session.messages;
  const firstUser = messages.find((message) => message.role === "user");
  const firstText =
    typeof firstUser?.content === "string"
      ? firstUser.content
      : (firstUser?.content?.find((part: { type: string }) => part.type === "text") as { text?: string } | undefined)
          ?.text;
  return {
    id: record.id,
    firstMessage: firstText ?? "",
    messageCount: messages.length,
    created: new Date(record.lastUsedAt).toISOString(),
    modified: new Date(record.lastUsedAt).toISOString(),
  };
}

// Chat ids double as Pi session ids, whose rules are stricter than the old
// bridge rule: they must start and end with an alphanumeric character.
const SAFE_CHAT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

export function assertSafeChatId(chatId: string): void {
  if (!SAFE_CHAT_ID.test(chatId)) {
    throw new Error(
      "Invalid chat id. Use 1-128 characters from A-Z, a-z, 0-9, _ or -, starting and ending with an alphanumeric character.",
    );
  }
}
