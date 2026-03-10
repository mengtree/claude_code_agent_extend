import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { AgentSession, IncomingMessageJob, PushMessage, SessionTask } from './types';
import { DebugLogger } from './DebugLogger';

export class Storage {
  readonly rootPath: string;
  readonly sessionsFilePath: string;
  readonly queuesDirectoryPath: string;
  readonly incomingMessagesFilePath: string;
  readonly pushEventsFilePath: string;
  readonly locksDirectoryPath: string;

  constructor(workspacePath: string) {
    this.rootPath = join(workspacePath, '.agent-extend');
    this.sessionsFilePath = join(this.rootPath, 'sessions.json');
    this.queuesDirectoryPath = join(this.rootPath, 'queues');
    this.incomingMessagesFilePath = join(this.rootPath, 'incoming-messages.json');
    this.pushEventsFilePath = join(this.rootPath, 'push-events.jsonl');
    this.locksDirectoryPath = join(this.rootPath, 'locks');
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true });
    await mkdir(this.queuesDirectoryPath, { recursive: true });
    await mkdir(this.locksDirectoryPath, { recursive: true });

    await this.ensureJsonFile(this.sessionsFilePath, []);
    await this.ensureJsonFile(this.incomingMessagesFilePath, []);

    if (!(await this.exists(this.pushEventsFilePath))) {
      await writeFile(this.pushEventsFilePath, '', 'utf8');
    }
  }

  async loadSessions(): Promise<AgentSession[]> {
    await this.initialize();
    return this.readJson<AgentSession[]>(this.sessionsFilePath, []);
  }

  async saveSessions(sessions: AgentSession[]): Promise<void> {
    await this.initialize();
    await this.writeJson(this.sessionsFilePath, sessions);
  }

  async loadIncomingMessages(): Promise<IncomingMessageJob[]> {
    await this.initialize();
    return this.readJson<IncomingMessageJob[]>(this.incomingMessagesFilePath, []);
  }

  async saveIncomingMessages(messages: IncomingMessageJob[]): Promise<void> {
    await this.initialize();
    await this.writeJson(this.incomingMessagesFilePath, messages);
  }

  async loadQueue(sessionId: string): Promise<SessionTask[]> {
    await this.initialize();
    return this.readJson<SessionTask[]>(this.getQueueFilePath(sessionId), []);
  }

  async saveQueue(sessionId: string, tasks: SessionTask[]): Promise<void> {
    await this.initialize();
    await this.writeJson(this.getQueueFilePath(sessionId), tasks);
  }

  async deleteQueue(sessionId: string): Promise<void> {
    const queueFilePath = this.getQueueFilePath(sessionId);

    if (await this.exists(queueFilePath)) {
      await rm(queueFilePath, { force: true });
    }
  }

  async appendPushMessage(message: PushMessage): Promise<void> {
    await this.initialize();
    await this.withExclusiveLock('push-events', async () => {
      await writeFile(this.pushEventsFilePath, `${JSON.stringify(message)}\n`, {
        encoding: 'utf8',
        flag: 'a'
      });
    });
  }

  async withSessionsLock<T>(operation: (sessions: AgentSession[]) => Promise<T> | T): Promise<T> {
    await this.initialize();

    return this.withExclusiveLock('sessions', async () => {
      const sessions = await this.readJson<AgentSession[]>(this.sessionsFilePath, []);
      const result = await operation(structuredClone(sessions));
      return result;
    });
  }

  async writeSessionsUnsafe(sessions: AgentSession[]): Promise<void> {
    await this.writeJson(this.sessionsFilePath, sessions);
  }

  async withQueueLock<T>(sessionId: string, operation: (tasks: SessionTask[]) => Promise<T> | T): Promise<T> {
    await this.initialize();

    return this.withExclusiveLock(`queue-${sessionId}`, async () => {
      const queueFilePath = this.getQueueFilePath(sessionId);
      const tasks = await this.readJson<SessionTask[]>(queueFilePath, []);
      const result = await operation(structuredClone(tasks));
      return result;
    });
  }

  async writeQueueUnsafe(sessionId: string, tasks: SessionTask[]): Promise<void> {
    await this.writeJson(this.getQueueFilePath(sessionId), tasks);
  }

  async withIncomingMessagesLock<T>(operation: (messages: IncomingMessageJob[]) => Promise<T> | T): Promise<T> {
    await this.initialize();

    return this.withExclusiveLock('incoming-messages', async () => {
      const messages = await this.readJson<IncomingMessageJob[]>(this.incomingMessagesFilePath, []);
      const result = await operation(structuredClone(messages));
      return result;
    });
  }

  async writeIncomingMessagesUnsafe(messages: IncomingMessageJob[]): Promise<void> {
    await this.writeJson(this.incomingMessagesFilePath, messages);
  }

  async loadPushMessages(limit = 20, sessionId?: string): Promise<PushMessage[]> {
    await this.initialize();

    const rawContent = await readFile(this.pushEventsFilePath, 'utf8');
    const messages = rawContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as PushMessage);

    const filteredMessages = sessionId
      ? messages.filter((message) => message.sessionId === sessionId)
      : messages;

    return filteredMessages.slice(-limit);
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private getQueueFilePath(sessionId: string): string {
    return join(this.queuesDirectoryPath, `${sessionId}.json`);
  }

  private async ensureJsonFile(filePath: string, fallback: unknown): Promise<void> {
    if (await this.exists(filePath)) {
      return;
    }

    const backupFilePath = this.getBackupFilePath(filePath);

    if (await this.exists(backupFilePath)) {
      const restored = await this.tryRestoreFromBackup(filePath, backupFilePath);

      if (restored) {
        return;
      }
    }

    await this.writeJson(filePath, fallback);
  }

  private async withExclusiveLock<T>(lockName: string, operation: () => Promise<T>): Promise<T> {
    const lockPath = join(this.locksDirectoryPath, `${lockName}.lock`);
    const timeoutAt = Date.now() + 10000;

    for (;;) {
      try {
        await mkdir(lockPath);
        break;
      } catch (error) {
        if (Date.now() >= timeoutAt) {
          throw new Error(`Timed out waiting for lock ${lockName}.`);
        }

        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;

        if (code !== 'EEXIST') {
          throw error;
        }

        await this.sleep(50);
      }
    }

    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    const primaryResult = await this.tryReadJsonFile<T>(filePath);

    if (primaryResult.ok) {
      return primaryResult.value;
    }

    const backupFilePath = this.getBackupFilePath(filePath);
    const backupResult = await this.tryReadJsonFile<T>(backupFilePath);

    if (backupResult.ok) {
      await writeFile(filePath, backupResult.rawContent, 'utf8');
      DebugLogger.warn('storage.restored_from_backup', {
        filePath,
        backupFilePath,
        reason: primaryResult.reason
      });
      return backupResult.value;
    }

    return fallback;
  }

  private async writeJson(filePath: string, content: unknown): Promise<void> {
    await this.initializeParentDirectory(filePath);
    const temporaryFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const serializedContent = `${JSON.stringify(content, null, 2)}\n`;
    const backupFilePath = this.getBackupFilePath(filePath);
    const hadPrimaryFile = await this.exists(filePath);

    await writeFile(temporaryFilePath, serializedContent, 'utf8');

    if (hadPrimaryFile) {
      await rm(backupFilePath, { force: true });
      await rename(filePath, backupFilePath);
    }

    try {
      await rename(temporaryFilePath, filePath);
    } catch (error) {
      await rm(temporaryFilePath, { force: true });

      if (hadPrimaryFile && !(await this.exists(filePath)) && (await this.exists(backupFilePath))) {
        await rename(backupFilePath, filePath);
      }

      throw error;
    }
  }

  private getBackupFilePath(filePath: string): string {
    return `${filePath}.bak`;
  }

  private async initializeParentDirectory(filePath: string): Promise<void> {
    const lastSeparatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));

    if (lastSeparatorIndex < 0) {
      return;
    }

    await mkdir(filePath.slice(0, lastSeparatorIndex), { recursive: true });
  }

  private async tryRestoreFromBackup(filePath: string, backupFilePath: string): Promise<boolean> {
    const backupResult = await this.tryReadJsonFile<unknown>(backupFilePath);

    if (!backupResult.ok) {
      return false;
    }

    await this.initializeParentDirectory(filePath);
    await writeFile(filePath, backupResult.rawContent, 'utf8');
    DebugLogger.warn('storage.restored_missing_file', {
      filePath,
      backupFilePath
    });
    return true;
  }

  private async tryReadJsonFile<T>(filePath: string): Promise<
    | { ok: true; value: T; rawContent: string }
    | { ok: false; reason: 'missing' | 'empty' | 'invalid_json' }
  > {
    if (!(await this.exists(filePath))) {
      return { ok: false, reason: 'missing' };
    }

    const rawContent = await readFile(filePath, 'utf8');

    if (!rawContent.trim()) {
      return { ok: false, reason: 'empty' };
    }

    try {
      return {
        ok: true,
        value: JSON.parse(rawContent) as T,
        rawContent
      };
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}