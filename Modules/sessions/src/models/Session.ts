/**
 * 会话模型
 *
 * 负责会话的创建、读取、更新和删除操作
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { StoredSession, SessionStatus, CreateSessionRequest, SessionMessage } from '../types/index.js';

/**
 * 会话存储选项
 */
export interface SessionStoreOptions {
  /** 数据目录路径 */
  dataDir: string;
  /** 是否自动创建目录 */
  autoCreate?: boolean;
}

/**
 * 会话模型类
 */
export class SessionModel {
  private readonly dataDir: string;
  private readonly sessionsFile: string;
  private readonly messagesFile: string;
  private sessionsCache: Map<string, StoredSession> | null = null;
  private messagesCache: Map<string, SessionMessage[]> | null = null;

  constructor(options: SessionStoreOptions) {
    this.dataDir = options.dataDir;
    this.sessionsFile = join(this.dataDir, 'sessions.json');
    this.messagesFile = join(this.dataDir, 'messages.json');
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }
    await this.loadSessions();
    await this.loadMessages();
  }

  /**
   * 创建新会话
   */
  async create(request: CreateSessionRequest): Promise<StoredSession> {
    const now = new Date().toISOString();
    const sessionId = randomUUID();

    const session: StoredSession = {
      id: sessionId,
      claudeSessionId: undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      externalMappings: []
    };

    // 添加外部映射（如果提供）
    if (request.externalSource && request.externalConversationId) {
      session.externalMappings.push({
        source: request.externalSource,
        conversationId: request.externalConversationId,
        mappedAt: now
      });
    }

    await this.saveSession(session);
    return session;
  }

  /**
   * 根据 ID 获取会话
   */
  async findById(sessionId: string): Promise<StoredSession | null> {
    await this.ensureSessionsLoaded();
    const session = this.sessionsCache?.get(sessionId);
    return session || null;
  }

  /**
   * 根据 Claude 会话 ID 获取会话
   */
  async findByClaudeSessionId(claudeSessionId: string): Promise<StoredSession | null> {
    await this.ensureSessionsLoaded();
    if (!this.sessionsCache) return null;

    for (const session of this.sessionsCache.values()) {
      if (session.claudeSessionId === claudeSessionId) {
        return session;
      }
    }
    return null;
  }

  /**
   * 根据外部映射获取会话
   */
  async findByExternalMapping(
    source: string,
    conversationId: string
  ): Promise<StoredSession | null> {
    await this.ensureSessionsLoaded();
    if (!this.sessionsCache) return null;

    for (const session of this.sessionsCache.values()) {
      const mapping = session.externalMappings.find(
        m => m.source === source && m.conversationId === conversationId
      );
      if (mapping) {
        return session;
      }
    }
    return null;
  }

  /**
   * 列出所有会话
   */
  async list(options: { limit?: number; status?: SessionStatus } = {}): Promise<StoredSession[]> {
    await this.ensureSessionsLoaded();
    if (!this.sessionsCache) return [];

    let sessions = Array.from(this.sessionsCache.values());

    // 状态过滤
    if (options.status) {
      sessions = sessions.filter(s => s.status === options.status);
    }

    // 按最后活跃时间排序
    sessions.sort((a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );

    // 限制数量
    if (options.limit && options.limit > 0) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions;
  }

  /**
   * 更新会话
   */
  async update(
    sessionId: string,
    updates: Partial<Pick<StoredSession, 'claudeSessionId' | 'status' | 'metadata'>>
  ): Promise<StoredSession | null> {
    const session = await this.findById(sessionId);
    if (!session) return null;

    Object.assign(session, updates, {
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    });

    await this.saveSession(session);
    return session;
  }

  /**
   * 更新会话活跃时间
   */
  async touch(sessionId: string): Promise<void> {
    const session = await this.findById(sessionId);
    if (session) {
      session.lastActiveAt = new Date().toISOString();
      session.updatedAt = new Date().toISOString();
      await this.saveSession(session);
    }
  }

  /**
   * 删除会话（软删除）
   */
  async delete(sessionId: string): Promise<boolean> {
    const session = await this.findById(sessionId);
    if (!session) return false;

    session.status = 'deleted';
    session.updatedAt = new Date().toISOString();
    session.lastActiveAt = new Date().toISOString();
    await this.saveSession(session);
    return true;
  }

  /**
   * 获取会话消息
   */
  async listMessages(sessionId: string): Promise<SessionMessage[]> {
    await this.ensureMessagesLoaded();
    return [...(this.messagesCache?.get(sessionId) || [])];
  }

  /**
   * 追加一轮消息
   */
  async appendMessageTurn(sessionId: string, message: string, reply: string): Promise<{
    userMessage: SessionMessage;
    assistantMessage: SessionMessage;
    messages: SessionMessage[];
  }> {
    const session = await this.findById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await this.ensureMessagesLoaded();

    const history = [...(this.messagesCache?.get(sessionId) || [])];
    const now = new Date().toISOString();

    const userMessage: SessionMessage = {
      id: randomUUID(),
      sessionId,
      role: 'user',
      content: message,
      createdAt: now
    };

    const assistantMessage: SessionMessage = {
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      content: reply,
      createdAt: new Date().toISOString()
    };

    history.push(userMessage, assistantMessage);
    this.messagesCache?.set(sessionId, history);

    await this.persistMessages();
    await this.touch(sessionId);

    return {
      userMessage,
      assistantMessage,
      messages: [...history]
    };
  }

  /**
   * 永久删除会话
   */
  async permanentlyDelete(sessionId: string): Promise<boolean> {
    const session = await this.findById(sessionId);
    if (!session) return false;

    this.sessionsCache?.delete(sessionId);
    await this.persistSessions();

    await this.ensureMessagesLoaded();
    this.messagesCache?.delete(sessionId);
    await this.persistMessages();

    return true;
  }

  /**
   * 清理已删除的会话
   */
  async cleanupDeletedSessions(olderThanDays: number = 30): Promise<number> {
    await this.ensureSessionsLoaded();
    if (!this.sessionsCache) return 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let deletedCount = 0;

    for (const [sessionId, session] of this.sessionsCache.entries()) {
      if (session.status === 'deleted') {
        const updatedDate = new Date(session.updatedAt);
        if (updatedDate < cutoffDate) {
          this.sessionsCache.delete(sessionId);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      await this.persistSessions();
    }

    return deletedCount;
  }

  /**
   * 保存单个会话
   */
  private async saveSession(session: StoredSession): Promise<void> {
    await this.ensureSessionsLoaded();
    if (this.sessionsCache) {
      this.sessionsCache.set(session.id, session);
    }
    await this.persistSessions();
  }

  /**
   * 持久化所有会话到磁盘
   */
  private async persistSessions(): Promise<void> {
    if (!this.sessionsCache) return;

    const sessionsArray = Array.from(this.sessionsCache.values());
    await writeFile(
      this.sessionsFile,
      JSON.stringify(sessionsArray, null, 2),
      'utf-8'
    );
  }

  /**
   * 持久化所有消息到磁盘
   */
  private async persistMessages(): Promise<void> {
    if (!this.messagesCache) return;

    const payload = Object.fromEntries(this.messagesCache.entries());
    await writeFile(
      this.messagesFile,
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
  }

  /**
   * 从磁盘加载会话
   */
  private async loadSessions(): Promise<void> {
    try {
      if (existsSync(this.sessionsFile)) {
        const content = await readFile(this.sessionsFile, 'utf-8');
        const sessionsArray = JSON.parse(content) as StoredSession[];
        this.sessionsCache = new Map(
          sessionsArray.map(s => [s.id, s])
        );
      } else {
        this.sessionsCache = new Map();
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      this.sessionsCache = new Map();
    }
  }

  /**
   * 从磁盘加载消息
   */
  private async loadMessages(): Promise<void> {
    try {
      if (existsSync(this.messagesFile)) {
        const content = await readFile(this.messagesFile, 'utf-8');
        const messagesObject = JSON.parse(content) as Record<string, SessionMessage[]>;
        this.messagesCache = new Map(Object.entries(messagesObject));
      } else {
        this.messagesCache = new Map();
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      this.messagesCache = new Map();
    }
  }

  /**
   * 确保会话已加载
   */
  private async ensureSessionsLoaded(): Promise<void> {
    if (!this.sessionsCache) {
      await this.loadSessions();
    }
  }

  /**
   * 确保消息已加载
   */
  private async ensureMessagesLoaded(): Promise<void> {
    if (!this.messagesCache) {
      await this.loadMessages();
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    deleted: number;
  }> {
    await this.ensureSessionsLoaded();
    if (!this.sessionsCache) {
      return { total: 0, active: 0, deleted: 0 };
    }

    let active = 0;
    let deleted = 0;

    for (const session of this.sessionsCache.values()) {
      if (session.status === 'active') active++;
      else if (session.status === 'deleted') deleted++;
    }

    return {
      total: this.sessionsCache.size,
      active,
      deleted
    };
  }
}
