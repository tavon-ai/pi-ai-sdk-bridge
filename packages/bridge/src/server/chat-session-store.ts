import {
  AuthStorage,
  createAgentSession,
  type AgentSession,
  ModelRegistry,
  SessionManager,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

export interface ChatSessionStoreOptions {
  cwd?: string;
  tools?: string[];
  idleTtlMs?: number;
  maxSessions?: number;
  createSessionOptions?: Partial<CreateAgentSessionOptions>;
}

export interface ChatSessionRecord {
  id: string;
  session: AgentSession;
  lastUsedAt: number;
}

export class ChatSessionStore {
  private readonly cwd: string;
  private readonly tools: string[] | undefined;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private readonly createSessionOptions: Partial<CreateAgentSessionOptions>;
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

  delete(chatId: string): boolean {
    assertSafeChatId(chatId);
    const existing = this.sessions.get(chatId);
    if (!existing) return false;
    existing.session.dispose();
    return this.sessions.delete(chatId);
  }

  dispose(): void {
    for (const record of this.sessions.values()) record.session.dispose();
    this.sessions.clear();
  }

  private async create(chatId: string): Promise<ChatSessionRecord> {
    if (this.sessions.size >= this.maxSessions) this.evictLeastRecentlyUsed();

    const { session } = await createAgentSession({
      cwd: this.cwd,
      sessionManager: SessionManager.inMemory(this.cwd),
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      tools: this.tools,
      ...this.createSessionOptions,
    });

    const record = { id: chatId, session, lastUsedAt: Date.now() };
    this.sessions.set(chatId, record);
    return record;
  }

  private evictIdle(): void {
    const cutoff = Date.now() - this.idleTtlMs;
    for (const [id, record] of this.sessions) {
      if (record.lastUsedAt < cutoff && !record.session.isStreaming) this.delete(id);
    }
  }

  private evictLeastRecentlyUsed(): void {
    let oldest: ChatSessionRecord | undefined;
    for (const record of this.sessions.values()) {
      if (record.session.isStreaming) continue;
      if (!oldest || record.lastUsedAt < oldest.lastUsedAt) oldest = record;
    }
    if (!oldest) throw new Error("Maximum concurrent streaming sessions reached");
    this.delete(oldest.id);
  }
}

const SAFE_CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function assertSafeChatId(chatId: string): void {
  if (!SAFE_CHAT_ID.test(chatId)) {
    throw new Error("Invalid chat id. Use 1-128 characters from A-Z, a-z, 0-9, _ or -.");
  }
}
