import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformRuntime } from '../runtime/PlatformRuntime.js';
import { createLogger } from '../utils/Logger.js';
import type { MessageEnvelope } from '../types.js';
import { randomUUID } from 'node:crypto';

interface SSEConnection {
  id: string;
  module: string;
  response: ServerResponse;
  connectedAt: Date;
  topics?: string[];
  filter?: {
    fromModule?: string;
    action?: string;
  };
}

export class ControlServer {
  private server?: ReturnType<typeof createServer>;
  private readonly startedAt = Date.now();
  private readonly logger;
  private readonly sseConnections = new Map<string, SSEConnection>();
  private readonly staticDir: string;

  constructor(
    private readonly runtime: PlatformRuntime,
    private readonly version: string,
    logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'
  ) {
    this.logger = createLogger(logLevel);
    // Set static files directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = join(__filename, '..');
    this.staticDir = join(__dirname, '../../static');
  }

  async listen(port: number, host: string): Promise<void> {
    if (this.server) {
      await this.close();
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = undefined;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = (request.method || 'GET').toUpperCase();
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (method === 'GET' && url.pathname === '/') {
      this.handleDashboard(response);
      return;
    }

    // API endpoint for dashboard data
    if (method === 'GET' && url.pathname === '/api/dashboard') {
      this.sendJson(response, 200, this.getDashboardData());
      return;
    }

    if (method === 'GET' && url.pathname === '/api/integrations') {
      this.sendJson(response, 200, {
        ok: true,
        items: this.getPluginPanels()
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/plugins') {
      this.sendJson(response, 200, {
        ok: true,
        items: this.runtime.getLoadedPlugins()
      });
      return;
    }

    // API endpoint for module details
    if (method === 'GET' && segments[0] === 'api' && segments[1] === 'modules' && segments[2]) {
      const moduleData = this.runtime.getRegistry().getModule(segments[2]);
      if (moduleData) {
        this.sendJson(response, 200, moduleData);
      } else {
        this.sendJson(response, 404, { error: 'Module not found' });
      }
      return;
    }

    // Serve static files
    if (method === 'GET' && url.pathname.startsWith('/static/')) {
      this.serveStaticFile(url.pathname, response);
      return;
    }

    if (segments[0] === 'plugin' && segments[1]) {
      const pluginId = decodeURIComponent(segments[1]);
      const suffix = segments.slice(2).join('/');
      const subPathname = suffix ? `/${suffix}` : '/';
      const subPath = `${subPathname}${url.search}`;
      const handled = await this.runtime.handlePluginRequest(pluginId, subPath, request, response);
      if (!handled && !response.headersSent) {
        this.sendJson(response, 404, { ok: false, error: `Plugin route not found: ${pluginId}${subPathname}` });
      }
      return;
    }

    if (method === 'GET' && url.pathname === '/health') {
      this.sendJson(response, 200, {
        ok: true,
        version: this.version,
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000)
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/status') {
      this.sendJson(response, 200, {
        ok: true,
        version: this.version,
        runtime: this.runtime.getStatus(),
        modules: this.runtime.getRegistry().getAllModules(),
        plugins: this.runtime.getLoadedPlugins()
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/deliveries') {
      this.sendJson(response, 200, {
        ok: true,
        count: this.runtime.getMessageBus().getAllHistory().length,
        items: this.runtime.getMessageBus().getAllHistory()
      });
      return;
    }

    if (method === 'POST' && segments.length === 3 && segments[0] === 'modules') {
      await this.handleModuleAction(segments[1], segments[2], response);
      return;
    }

    // 消息总线 POST /messages 端点
    if (method === 'POST' && url.pathname === '/messages') {
      await this.handlePostMessage(request, response);
      return;
    }

    // 消息总线 GET /subscribe 端点 (SSE)
    if (method === 'GET' && url.pathname === '/subscribe') {
      this.handleSSESubscribe(url, response);
      return;
    }

    // 获取订阅者列表
    if (method === 'GET' && url.pathname === '/subscribers') {
      this.sendJson(response, 200, {
        subscribers: Array.from(this.sseConnections.values()).map(conn => ({
          module: conn.module,
          topics: conn.topics,
          connectedAt: conn.connectedAt.toISOString()
        }))
      });
      return;
    }

    this.sendJson(response, 404, { ok: false, error: `Route ${method} ${url.pathname} not found` });
  }

  private async handleModuleAction(moduleId: string, action: string, response: ServerResponse): Promise<void> {
    try {
      if (action === 'start') {
        const pid = await this.runtime.startModule(moduleId);
        this.sendJson(response, 200, { ok: true, moduleId, action, pid });
        return;
      }

      if (action === 'stop') {
        const stopped = await this.runtime.stopModule(moduleId);
        this.sendJson(response, 200, { ok: true, moduleId, action, stopped });
        return;
      }

      if (action === 'restart') {
        const pid = await this.runtime.restartModule(moduleId);
        this.sendJson(response, 200, { ok: true, moduleId, action, pid });
        return;
      }

      this.sendJson(response, 404, { ok: false, error: `Unsupported action: ${action}` });
    } catch (error) {
      this.logger.error(`[ControlServer] Failed module action ${action} for ${moduleId}:`, error);
      this.sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }

  /**
   * Handle dashboard page request
   */
  private handleDashboard(response: ServerResponse): void {
    const dashboardPath = join(this.staticDir, 'index.html');
    try {
      const content = readFileSync(dashboardPath, 'utf-8');
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(content);
    } catch (error) {
      this.logger.error('[ControlServer] Failed to read dashboard file:', error);
      this.sendJson(response, 500, { error: 'Dashboard not available' });
    }
  }

  /**
   * Serve static files
   */
  private serveStaticFile(pathname: string, response: ServerResponse): void {
    // Remove /static/ prefix and ensure safety
    const filePath = join(this.staticDir, pathname.replace(/^\/static\//, ''));
    try {
      const content = readFileSync(filePath);
      const ext = filePath.split('.').pop();

      const mimeTypes: Record<string, string> = {
        'js': 'application/javascript',
        'css': 'text/css',
        'html': 'text/html',
        'json': 'application/json',
        'png': 'image/png',
        'svg': 'image/svg+xml'
      };

      response.statusCode = 200;
      response.setHeader('Content-Type', mimeTypes[ext || ''] || 'application/octet-stream');
      response.end(content);
    } catch (error) {
      this.logger.error(`[ControlServer] Failed to serve static file ${pathname}:`, error);
      this.sendJson(response, 404, { error: 'File not found' });
    }
  }

  /**
   * Get dashboard data
   */
  private getDashboardData() {
    const registry = this.runtime.getRegistry();
    const messageBus = this.runtime.getMessageBus();

    return {
      ok: true,
      version: this.version,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      runtime: this.runtime.getStatus(),
      modules: registry.getAllModules().map(m => ({
        moduleId: m.moduleId,
        name: m.manifest.name,
        version: m.manifest.version,
        kind: m.manifest.kind,
        status: m.status,
        pid: m.pid,
        description: m.manifest.description,
        autoStart: m.manifest.startup?.autoStart || false,
        daemon: m.manifest.startup?.daemon || false,
        registeredAt: m.registeredAt,
        startedAt: m.startedAt
      })),
      processes: [],
      messages: {
        count: messageBus.getAllHistory().length,
        items: messageBus.getAllHistory().slice(-100) // Last 100 messages
      },
      integrations: this.getPluginPanels(),
      plugins: this.runtime.getLoadedPlugins(),
      subscribers: Array.from(this.sseConnections.values()).map(conn => ({
        module: conn.module,
        topics: conn.topics,
        connectedAt: conn.connectedAt.toISOString()
      }))
    };
  }

  /**
   * 处理 POST /messages 请求
   */
  private async handlePostMessage(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody(request) as Record<string, unknown>;
      const { fromModule, toModule, action, payload, replyTo, callbackTopic, traceId, context, timeoutMs } = body;

      // 验证必填字段
      if (!fromModule || !action) {
        this.sendJson(response, 400, {
          success: false,
          error: 'Missing required fields: fromModule, action'
        });
        return;
      }

      // 创建消息信封
      const envelope: MessageEnvelope = {
        messageId: randomUUID(),
        traceId: (traceId as string | undefined) || `trace-${Date.now()}`,
        fromModule: fromModule as string,
        toModule: (toModule as string | undefined) || '',
        action: action as string,
        payload,
        replyTo: (replyTo as string | undefined) || fromModule as string,
        callbackTopic: callbackTopic as string | undefined,
        context: (context as Record<string, unknown> | undefined) || {},
        timeoutMs: timeoutMs as number | undefined,
        createdAt: new Date().toISOString()
      };

      // 通过消息总线发送
      this.runtime.getMessageBus().send(envelope);

      // 如果有 SSE 订阅者，推送消息
      this.broadcastToSSE(envelope);

      this.sendJson(response, 200, {
        success: true,
        messageId: envelope.messageId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('[ControlServer] Failed to handle POST /messages:', error);
      this.sendJson(response, 400, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 处理 SSE /subscribe 请求
   */
  private handleSSESubscribe(url: URL, response: ServerResponse): void {
    const module = url.searchParams.get('module');
    if (!module) {
      this.sendJson(response, 400, { error: 'module parameter is required' });
      return;
    }

    const topics = url.searchParams.getAll('topics');
    const filterFromModule = url.searchParams.get('filter.fromModule');
    const filterAction = url.searchParams.get('filter.action');

    // 设置 SSE 响应头
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    // 创建 SSE 连接
    const connectionId = randomUUID();
    const connection: SSEConnection = {
      id: connectionId,
      module,
      response,
      connectedAt: new Date(),
      topics: topics.length > 0 ? topics : undefined,
      filter: {
        fromModule: filterFromModule || undefined,
        action: filterAction || undefined
      }
    };

    this.sseConnections.set(connectionId, connection);

    // 发送连接成功事件
    this.sendSSEEvent(response, 'connected', {
      module,
      connectionId,
      timestamp: new Date().toISOString()
    });

    this.logger.info(`[ControlServer] SSE connection established: ${module} (${connectionId})`);

    // 处理连接关闭
    response.on('close', () => {
      this.sseConnections.delete(connectionId);
      this.logger.info(`[ControlServer] SSE connection closed: ${module} (${connectionId})`);
    });

    // 启动心跳
    this.startSSEHeartbeat(connectionId);
  }

  /**
   * 广播消息到 SSE 订阅者
   */
  private broadcastToSSE(envelope: MessageEnvelope): void {
    for (const connection of this.sseConnections.values()) {
      const isDashboardConnection = connection.module.startsWith('dashboard-');

      // 检查目标模块匹配
      if (!isDashboardConnection && envelope.toModule && envelope.toModule !== connection.module) {
        continue;
      }

      // 检查回复模块匹配
      if (!isDashboardConnection && envelope.replyTo && envelope.replyTo !== connection.module) {
        continue;
      }

      // 检查主题匹配
      if (connection.topics && connection.topics.length > 0) {
        const matchesTopic = connection.topics.some(topic =>
          this.matchTopic(envelope.callbackTopic || '', topic)
        );
        if (!matchesTopic && !envelope.toModule) {
          continue;
        }
      }

      // 检查过滤器
      if (connection.filter?.fromModule && connection.filter.fromModule !== envelope.fromModule) {
        continue;
      }
      if (connection.filter?.action && connection.filter.action !== envelope.action) {
        continue;
      }

      // 发送 SSE 事件
      const eventType = envelope.replyTo === connection.module ? 'callback' : 'message';
      this.sendSSEEvent(connection.response, eventType, envelope);
    }
  }

  private getPluginPanels() {
    return this.runtime.getLoadedPlugins()
      .filter((plugin) => plugin.hasUi)
      .map((plugin) => ({
        panelId: plugin.pluginId,
        moduleId: plugin.moduleId,
        name: plugin.displayName,
        url: `${plugin.basePath}${plugin.homePath}`,
        securedUrl: `${plugin.basePath}${plugin.homePath}`,
        description: plugin.description,
        icon: plugin.icon,
        registeredAt: plugin.loadedAt || plugin.updatedAt,
        updatedAt: plugin.updatedAt
      }));
  }

  /**
   * 匹配主题（支持 * 通配符）
   */
  private matchTopic(actualTopic: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === actualTopic) return true;

    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(actualTopic);
  }

  /**
   * 发送 SSE 事件
   */
  private sendSSEEvent(response: ServerResponse, event: string, data: unknown): void {
    try {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      this.logger.error('[ControlServer] Failed to send SSE event:', error);
    }
  }

  /**
   * 启动 SSE 心跳
   */
  private startSSEHeartbeat(connectionId: string): void {
    const connection = this.sseConnections.get(connectionId);
    if (!connection) {
      return;
    }

    const interval = setInterval(() => {
      const conn = this.sseConnections.get(connectionId);
      if (!conn) {
        clearInterval(interval);
        return;
      }

      this.sendSSEEvent(conn.response, 'heartbeat', {
        timestamp: new Date().toISOString()
      });
    }, 30000); // 30秒心跳

    // 清理定时器 - 当连接关闭时
    const cleanup = () => {
      clearInterval(interval);
    };

    connection.response.on('close', cleanup);
  }

  /**
   * 读取 JSON 请求体
   */
  private readJsonBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
      request.on('error', reject);
    });
  }
}