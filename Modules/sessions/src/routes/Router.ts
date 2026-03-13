/**
 * 路由器
 *
 * 负责将 HTTP 请求路由到相应的控制器
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionController } from '../controllers/SessionController.js';
import type { HealthController } from '../controllers/HealthController.js';
import type { MessageController } from '../controllers/MessageController.js';
import type { PlaygroundController } from '../controllers/PlaygroundController.js';
import type { SessionModel } from '../models/Session.js';

/**
 * 路由选项
 */
export interface RouterOptions {
  /** 控制器 */
  sessionController: SessionController;
  healthController: HealthController;
  messageController: MessageController;
  playgroundController: PlaygroundController;
  sessionModel: SessionModel;
}

/**
 * 路由器类
 */
export class Router {
  private readonly sessionController: SessionController;
  private readonly healthController: HealthController;
  private readonly messageController: MessageController;
  private readonly playgroundController: PlaygroundController;
  private readonly sessionModel: SessionModel;
  private readonly publicDir: string;
  private server: Server | null = null;

  constructor(options: RouterOptions) {
    this.sessionController = options.sessionController;
    this.healthController = options.healthController;
    this.messageController = options.messageController;
    this.playgroundController = options.playgroundController;
    this.sessionModel = options.sessionModel;

    // 获取静态文件目录 - 指向模块根目录的 public 文件夹
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    this.publicDir = join(__dirname, '../public');
  }

  /**
   * 启动 HTTP 服务器
   */
  async listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handle(req, res).catch((error) => {
          console.error('Request handling error:', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal server error', ok: false }));
          }
        });
      });

      this.server.on('error', reject);

      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  async handle(request: IncomingMessage, response: ServerResponse, rawUrl?: string): Promise<void> {
    await this.handleRequest(request, response, rawUrl);
  }

  /**
   * 关闭 HTTP 服务器
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(request: IncomingMessage, response: ServerResponse, rawUrl?: string): Promise<void> {
    const url = new URL(rawUrl || request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const method = request.method?.toUpperCase() || 'GET';
    const path = url.pathname;

    // 设置 CORS 头
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      // 路由分发
      if ((path === '/' || path === '/playground') && method === 'GET') {
        await this.playgroundController.handlePage(url, response);
        return;
      }

      // 静态文件服务 (GET /public/*)
      if (path.startsWith('/public/') && method === 'GET') {
        this.serveStatic(path, response);
        return;
      }

      if (path === '/health' && method === 'GET') {
        const stats = await this.sessionModel.getStats();
        await this.healthController.handleHealth(response, stats.active);
        return;
      }

      if (path === '/ready' && method === 'GET') {
        await this.healthController.handleReady(response);
        return;
      }

      if (path === '/messages' && method === 'POST') {
        // 注意：这里需要将 IncomingMessage 转换为 Request
        // 在实际使用中可能需要使用 body-parser 或类似库
        await this.handleMessageRequest(request, response);
        return;
      }

      // 会话相关路由
      if (path === '/sessions' || path.startsWith('/sessions/')) {
        await this.handleSessionRoute(method, path, request, response);
        return;
      }

      // 404
      this.sendJson(response, 404, {
        error: 'Not found',
        ok: false,
        path
      });

    } catch (error) {
      console.error('Route handling error:', error);
      this.sendJson(response, 500, {
        error: 'Internal server error',
        ok: false
      });
    }
  }

  /**
   * 处理会话路由
   */
  private async handleSessionRoute(
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const isSessionDetailRoute = /^\/sessions\/[^/]+$/.test(path);
    const isSessionMessagesRoute = /^\/sessions\/[^/]+\/messages$/.test(path);
    const isSessionEventsRoute = /^\/sessions\/[^/]+\/events$/.test(path);

    // POST /sessions - 创建会话
    if (path === '/sessions' && method === 'POST') {
      await this.sessionController.handleCreateSession(request, response);
      return;
    }

    // GET /sessions - 列出会话
    if (path === '/sessions' && method === 'GET') {
      await this.sessionController.handleListSessions(request, response);
      return;
    }

    // GET /sessions/:sessionId/messages - 获取会话消息
    if (isSessionMessagesRoute && method === 'GET') {
      await this.sessionController.handleGetMessages(request, response);
      return;
    }

    // POST /sessions/:sessionId/messages - 发送消息
    if (isSessionMessagesRoute && method === 'POST') {
      await this.sessionController.handleSendMessage(request, response);
      return;
    }

    // GET /sessions/:sessionId/events - SSE 事件流
    if (isSessionEventsRoute && method === 'GET') {
      this.sessionController.handleSSEConnection(request, response);
      return;
    }

    // GET /sessions/:sessionId - 获取会话
    if (isSessionDetailRoute && method === 'GET') {
      await this.sessionController.handleGetSession(request, response);
      return;
    }

    // DELETE /sessions/:sessionId - 删除会话
    if (isSessionDetailRoute && method === 'DELETE') {
      await this.sessionController.handleDeleteSession(request, response);
      return;
    }

    // 其他方法返回 405
    this.sendJson(response, 405, {
      error: 'Method not allowed',
      ok: false
    });
  }

  /**
   * 处理消息请求
   */
  private async handleMessageRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // 读取请求体
    const body = await this.readBody(request);
    const data = JSON.parse(body);

    // 创建一个伪 Request 对象
    const pseudoRequest = {
      json: async () => data
    } as unknown as Request;

    await this.messageController.handleMessage(pseudoRequest, response);
  }

  /**
   * 读取请求体
   */
  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';

      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on('end', () => {
        resolve(body);
      });

      request.on('error', reject);
    });
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }

  /**
   * 提供静态文件服务
   */
  private serveStatic(path: string, response: ServerResponse): void {
    const filePath = join(this.publicDir, path.replace('/public/', ''));

    if (!existsSync(filePath)) {
      this.sendJson(response, 404, { error: 'File not found', ok: false });
      return;
    }

    // 根据扩展名设置 Content-Type
    const ext = filePath.split('.').pop();
    const contentTypes: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
     woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject'
    };

    const contentType = contentTypes[ext || ''] || 'application/octet-stream';

    // 创建文件流并响应
    const stream = createReadStream(filePath);
    stream.on('open', () => {
      response.setHeader('Content-Type', contentType);
      stream.pipe(response);
    });

    stream.on('error', (err) => {
      console.error('Static file error:', err);
      if (!response.headersSent) {
        this.sendJson(response, 500, { error: 'Internal server error', ok: false });
      }
    });
  }
}

/**
 * 创建路由器
 */
export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}
