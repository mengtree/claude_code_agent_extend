import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';
import { AgentRuntime } from './AgentRuntime';
import { ScheduleService } from './ScheduleService';
import { SessionManager } from './SessionManager';
import { TaskQueueService } from './TaskQueueService';
import { ImAdapterResponse, PushMessage, SessionTask } from './types';

export class HttpApiServer {
  private readonly publicDirectoryPath: string;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly sessionManager: SessionManager,
    private readonly taskQueueService: TaskQueueService,
    private readonly scheduleService: ScheduleService,
    workspacePath: string
  ) {
    this.publicDirectoryPath = join(workspacePath, 'public');
  }

  async listen(port: number): Promise<void> {
    const server = createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.sendJson(response, 500, { error: message });
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const pathSegments = url.pathname.split('/').filter((segment) => segment.length > 0);

    if (method === 'GET' && url.pathname === '/health') {
      this.sendJson(response, 200, { ok: true });
      return;
    }

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/im')) {
      await this.sendStaticFile(response, join(this.publicDirectoryPath, 'im.html'), 'text/html; charset=utf-8');
      return;
    }

    if (method === 'GET' && url.pathname === '/events') {
      await this.handleSseRequest(url, request, response);
      return;
    }

    if (method === 'POST' && url.pathname === '/messages') {
      const body = await this.readJsonBody(request);
      const result = await this.runtime.acceptIncomingMessage({
        message: this.requireString(body.message, 'message'),
        sessionId: this.optionalString(body.sessionId),
        externalSource: this.optionalString(body.externalSource),
        externalConversationId: this.optionalString(body.externalConversationId)
      });
      this.sendJson(response, 202, result);
      return;
    }

    if (method === 'POST' && url.pathname === '/adapters/im/messages') {
      const body = await this.readJsonBody(request);
      const source = this.requireString(body.source, 'source');
      const conversationId = this.requireString(body.conversationId, 'conversationId');
      const userId = this.optionalString(body.userId);

      const result = await this.runtime.acceptIncomingMessage({
        message: this.requireString(body.message, 'message'),
        externalSource: source,
        externalConversationId: conversationId,
        sessionId: this.optionalString(body.sessionId)
      });

      const payload: ImAdapterResponse = {
        source,
        conversationId,
        userId,
        sessionId: result.sessionId,
        reply: result.reply,
        intent: result.intent,
        status: result.status,
        acceptedMessageId: result.acceptedMessageId
      };

      this.sendJson(response, 202, payload);
      return;
    }

    if (method === 'GET' && url.pathname === '/adapters/im/tasks') {
      const source = this.requireQueryString(url, 'source');
      const conversationId = this.requireQueryString(url, 'conversationId');
      const session = await this.sessionManager.findSessionByExternalMapping(source, conversationId);
      const tasks: SessionTask[] = session
        ? await this.taskQueueService.list(session.id)
        : [];

      this.sendJson(response, 200, {
        source,
        conversationId,
        sessionId: session?.id,
        tasks
      });
      return;
    }

    if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'sessions' && pathSegments[2] === 'messages') {
      const body = await this.readJsonBody(request);
      const result = await this.runtime.acceptIncomingMessage({
        message: this.requireString(body.message, 'message'),
        sessionId: pathSegments[1],
        externalSource: this.optionalString(body.externalSource),
        externalConversationId: this.optionalString(body.externalConversationId)
      });
      this.sendJson(response, 202, result);
      return;
    }

    if (method === 'GET' && url.pathname === '/sessions') {
      const sessions = await this.sessionManager.listSessions();
      this.sendJson(response, 200, sessions);
      return;
    }

    if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'sessions') {
      await this.sessionManager.deleteSession(pathSegments[1], !this.parseBoolean(url.searchParams.get('keepClaude')));
      this.sendJson(response, 200, { deleted: true, sessionId: pathSegments[1] });
      return;
    }

    if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'sessions' && pathSegments[2] === 'clear') {
      const session = await this.sessionManager.clearSession(pathSegments[1], !this.parseBoolean(url.searchParams.get('keepClaude')));
      this.sendJson(response, 200, session);
      return;
    }

    if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'sessions' && pathSegments[2] === 'interrupt') {
      const session = await this.sessionManager.requestInterrupt(pathSegments[1]);
      this.sendJson(response, 202, session);
      return;
    }

    if (method === 'GET' && pathSegments.length === 3 && pathSegments[0] === 'sessions' && pathSegments[2] === 'tasks') {
      const tasks = await this.taskQueueService.list(pathSegments[1]);
      this.sendJson(response, 200, tasks);
      return;
    }

    if (method === 'GET' && pathSegments.length === 3 && pathSegments[0] === 'sessions' && pathSegments[2] === 'schedules') {
      const schedules = await this.scheduleService.list(pathSegments[1]);
      this.sendJson(response, 200, schedules);
      return;
    }

    if (method === 'DELETE' && pathSegments.length === 4 && pathSegments[0] === 'sessions' && pathSegments[2] === 'tasks') {
      const task = await this.taskQueueService.removeQueuedTask(pathSegments[1], pathSegments[3]);
      this.sendJson(response, 200, task ?? { deleted: false });
      return;
    }

    if (method === 'DELETE' && pathSegments.length === 4 && pathSegments[0] === 'sessions' && pathSegments[2] === 'schedules') {
      const removed = await this.scheduleService.remove(pathSegments[1], pathSegments[3]);
      this.sendJson(response, 200, { deleted: removed });
      return;
    }

    if (method === 'GET' && url.pathname === '/push') {
      const sessionId = url.searchParams.get('sessionId') || undefined;
      const limit = Number.parseInt(url.searchParams.get('limit') || '20', 10);
      const messages = await this.runtime.listPushMessages(Number.isNaN(limit) ? 20 : limit, sessionId);
      this.sendJson(response, 200, messages);
      return;
    }

    if (method === 'POST' && url.pathname === '/worker/run-once') {
      const pollMs = Number.parseInt(url.searchParams.get('pollMs') || '1000', 10);
      await this.runtime.drainUntilIdle(Number.isNaN(pollMs) ? 1000 : pollMs);
      this.sendJson(response, 200, { ok: true });
      return;
    }

    this.sendJson(response, 404, { error: `Route ${method} ${url.pathname} was not found.` });
  }

  private async handleSseRequest(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const sessionId = url.searchParams.get('sessionId') || undefined;
    const replayLimit = Number.parseInt(url.searchParams.get('replay') || '20', 10);
    const normalizedReplayLimit = Number.isNaN(replayLimit) ? 20 : replayLimit;

    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.write(': connected\n\n');

    const recentMessages = await this.runtime.listPushMessages(normalizedReplayLimit, sessionId);

    for (const message of recentMessages) {
      this.writeSseEvent(response, 'push', message);
    }

    const unsubscribe = this.runtime.subscribeToPushMessages((message) => {
      this.writeSseEvent(response, 'push', message);
    }, sessionId);

    const heartbeat = setInterval(() => {
      response.write(': heartbeat\n\n');
    }, 15000);

    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      response.end();
    });
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const bodyText = await new Promise<string>((resolve, reject) => {
      let body = '';

      request.on('data', (chunk: Buffer | string) => {
        body += chunk.toString();
      });

      request.on('end', () => {
        resolve(body);
      });

      request.on('error', reject);
    });

    if (!bodyText.trim()) {
      return {};
    }

    return JSON.parse(bodyText) as Record<string, unknown>;
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(payload, null, 2)}\n`);
  }

  private async sendStaticFile(response: ServerResponse, filePath: string, contentType: string): Promise<void> {
    const content = await readFile(filePath, 'utf8');
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.end(content);
  }

  private writeSseEvent(response: ServerResponse, eventName: string, payload: PushMessage): void {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private requireString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${fieldName} must be a non-empty string.`);
    }

    return value;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private parseBoolean(value: string | null): boolean {
    return value === 'true' || value === '1';
  }

  private requireQueryString(url: URL, fieldName: string): string {
    const value = url.searchParams.get(fieldName);

    if (!value || value.trim().length === 0) {
      throw new Error(`${fieldName} query parameter is required.`);
    }

    return value;
  }

}