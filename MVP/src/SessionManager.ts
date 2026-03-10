import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { AgentSession } from './types';
import { Storage } from './Storage';
import { normalizeWorkspacePath } from './WorkspacePath';

export interface ResolveSessionOptions {
  sessionId?: string;
  externalSource?: string;
  externalConversationId?: string;
}

export class SessionManager {
  constructor(
    private readonly storage: Storage,
    private readonly workspacePath: string
  ) {}

  async resolveSession(options: ResolveSessionOptions): Promise<AgentSession> {
    return this.storage.withSessionsLock(async (sessions) => {
      let resolvedSession: AgentSession | undefined;
      let requestedSession: AgentSession | undefined;

      if (options.sessionId) {
        requestedSession = sessions.find((session) => session.id === options.sessionId && session.status === 'active');
      }

      if (options.externalSource && options.externalConversationId) {
        const existingSession = sessions.find(
          (session) =>
            session.status === 'active' &&
            session.externalMappings.some(
              (mapping) =>
                mapping.source === options.externalSource &&
                mapping.conversationId === options.externalConversationId
            )
        );

        if (existingSession) {
          resolvedSession = existingSession;
        }
      }

      if (!resolvedSession && options.sessionId) {
        if (!requestedSession) {
          throw new Error(`Session ${options.sessionId} was not found.`);
        }

        resolvedSession = requestedSession;
      }

      if (resolvedSession) {
        const updatedSession = this.bindSessionResolution(resolvedSession, options);
        const normalizedSessions = sessions.map((session) => {
          if (session.id === updatedSession.id) {
            return updatedSession;
          }

          return this.removeExternalMapping(session, options);
        });

        await this.storage.writeSessionsUnsafe(normalizedSessions);
        return updatedSession;
      }

      const now = new Date().toISOString();
      const session: AgentSession = {
        id: randomUUID(),
        workspacePath: this.workspacePath,
        claudeProjectPath: this.getClaudeProjectPath(this.workspacePath),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
        interruptRequested: false,
        externalMappings:
          options.externalSource && options.externalConversationId
            ? [{ source: options.externalSource, conversationId: options.externalConversationId }]
            : []
      };

      sessions.push(session);
      await this.storage.writeSessionsUnsafe(sessions);
      return session;
    });
  }

  async findSessionByExternalMapping(source: string, conversationId: string): Promise<AgentSession | undefined> {
    const sessions = await this.storage.loadSessions();
    return sessions.find(
      (session) =>
        session.status === 'active' &&
        session.externalMappings.some(
          (mapping) => mapping.source === source && mapping.conversationId === conversationId
        )
    );
  }

  async listSessions(): Promise<AgentSession[]> {
    const sessions = await this.storage.loadSessions();
    return sessions.filter((session) => session.status === 'active');
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    const sessions = await this.storage.loadSessions();
    const session = sessions.find((item) => item.id === sessionId && item.status === 'active');

    if (!session) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    return session;
  }

  async tryGetSession(sessionId: string): Promise<AgentSession | undefined> {
    const sessions = await this.storage.loadSessions();
    return sessions.find((item) => item.id === sessionId && item.status === 'active');
  }

  async updateSession(sessionId: string, update: (session: AgentSession) => AgentSession): Promise<AgentSession> {
    return this.storage.withSessionsLock(async (sessions) => {
      const sessionIndex = sessions.findIndex((session) => session.id === sessionId && session.status === 'active');

      if (sessionIndex < 0) {
        throw new Error(`Session ${sessionId} was not found.`);
      }

      const updatedSession = update({ ...sessions[sessionIndex] });
      updatedSession.updatedAt = new Date().toISOString();
      sessions[sessionIndex] = updatedSession;
      await this.storage.writeSessionsUnsafe(sessions);
      return updatedSession;
    });
  }

  async attachClaudeSessionId(sessionId: string, claudeSessionId?: string): Promise<AgentSession> {
    return this.updateSession(sessionId, (session) => ({
      ...session,
      claudeSessionId: claudeSessionId ?? session.claudeSessionId,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async tryAttachClaudeSessionId(sessionId: string, claudeSessionId?: string): Promise<AgentSession | undefined> {
    return this.tryUpdateSession(sessionId, (session) => ({
      ...session,
      claudeSessionId: claudeSessionId ?? session.claudeSessionId,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async setCurrentTask(sessionId: string, taskId?: string): Promise<AgentSession> {
    return this.updateSession(sessionId, (session) => ({
      ...session,
      currentTaskId: taskId,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async trySetCurrentTask(sessionId: string, taskId?: string): Promise<AgentSession | undefined> {
    return this.tryUpdateSession(sessionId, (session) => ({
      ...session,
      currentTaskId: taskId,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async requestInterrupt(sessionId: string): Promise<AgentSession> {
    return this.updateSession(sessionId, (session) => ({
      ...session,
      interruptRequested: true,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async clearInterrupt(sessionId: string): Promise<AgentSession> {
    return this.updateSession(sessionId, (session) => ({
      ...session,
      interruptRequested: false,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async tryClearInterrupt(sessionId: string): Promise<AgentSession | undefined> {
    return this.tryUpdateSession(sessionId, (session) => ({
      ...session,
      interruptRequested: false,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async clearSession(sessionId: string, purgeClaudeSession = true): Promise<AgentSession> {
    const session = await this.getSession(sessionId);

    if (purgeClaudeSession && session.claudeSessionId) {
      await this.deleteClaudeSessionFile(session);
    }

    await this.storage.deleteQueue(sessionId);

    return this.updateSession(sessionId, (currentSession) => ({
      ...currentSession,
      claudeSessionId: undefined,
      currentTaskId: undefined,
      interruptRequested: false,
      lastActiveAt: new Date().toISOString()
    }));
  }

  async deleteSession(sessionId: string, purgeClaudeSession = true): Promise<void> {
    const session = await this.getSession(sessionId);

    if (purgeClaudeSession && session.claudeSessionId) {
      await this.deleteClaudeSessionFile(session);
    }

    await this.storage.deleteQueue(sessionId);
    await this.storage.withSessionsLock(async (sessions) => {
      await this.storage.writeSessionsUnsafe(sessions.filter((item) => item.id !== sessionId));
    });
  }

  private async tryUpdateSession(
    sessionId: string,
    update: (session: AgentSession) => AgentSession
  ): Promise<AgentSession | undefined> {
    return this.storage.withSessionsLock(async (sessions) => {
      const sessionIndex = sessions.findIndex((session) => session.id === sessionId && session.status === 'active');

      if (sessionIndex < 0) {
        return undefined;
      }

      const updatedSession = update({ ...sessions[sessionIndex] });
      updatedSession.updatedAt = new Date().toISOString();
      sessions[sessionIndex] = updatedSession;
      await this.storage.writeSessionsUnsafe(sessions);
      return updatedSession;
    });
  }

  private async deleteClaudeSessionFile(session: AgentSession): Promise<void> {
    const claudeSessionId = session.claudeSessionId;

    if (!claudeSessionId) {
      return;
    }

    const sessionFilePath = join(session.claudeProjectPath, `${claudeSessionId}.jsonl`);
    await rm(sessionFilePath, { force: true });
  }

  private getClaudeProjectPath(workspacePath: string): string {
    const sanitizedWorkspacePath = normalizeWorkspacePath(workspacePath).replace(/[:\\/]/g, '-');
    return join(homedir(), '.claude', 'projects', sanitizedWorkspacePath);
  }

  private bindSessionResolution(session: AgentSession, options: ResolveSessionOptions): AgentSession {
    const now = new Date().toISOString();
    const externalMappings = this.mergeExternalMapping(
      session.externalMappings,
      options.externalSource,
      options.externalConversationId
    );

    return {
      ...session,
      externalMappings,
      updatedAt: now,
      lastActiveAt: now
    };
  }

  private mergeExternalMapping(
    mappings: AgentSession['externalMappings'],
    source?: string,
    conversationId?: string
  ): AgentSession['externalMappings'] {
    if (!source || !conversationId) {
      return mappings;
    }

    const mappingExists = mappings.some(
      (mapping) => mapping.source === source && mapping.conversationId === conversationId
    );

    if (mappingExists) {
      return mappings;
    }

    return [...mappings, { source, conversationId }];
  }

  private removeExternalMapping(session: AgentSession, options: ResolveSessionOptions): AgentSession {
    if (!options.externalSource || !options.externalConversationId) {
      return session;
    }

    const nextMappings = session.externalMappings.filter(
      (mapping) =>
        mapping.source !== options.externalSource ||
        mapping.conversationId !== options.externalConversationId
    );

    if (nextMappings.length === session.externalMappings.length) {
      return session;
    }

    return {
      ...session,
      externalMappings: nextMappings,
      updatedAt: new Date().toISOString()
    };
  }
}