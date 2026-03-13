import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { HealthController } from '../controllers/HealthController.js';
import type { MessageController } from '../controllers/MessageController.js';
import type { ScheduleController } from '../controllers/ScheduleController.js';
import type { ScheduleStore } from '../models/ScheduleStore.js';

interface RouterOptions {
  healthController: HealthController;
  messageController: MessageController;
  scheduleController: ScheduleController;
  scheduleStore: ScheduleStore;
}

export class Router {
  private server: Server | null = null;

  constructor(private readonly options: RouterOptions) {}

  async listen(port: number, host: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((request, response) => {
        void this.handle(request, response).catch((error) => {
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
          }
        });
      });

      this.server.on('error', reject);
      this.server.listen(port, host, () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
  }

  async handle(request: IncomingMessage, response: ServerResponse, rawUrl?: string): Promise<void> {
    await this.handleRequest(request, response, rawUrl);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse, rawUrl?: string): Promise<void> {
    const url = new URL(rawUrl || request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const method = request.method?.toUpperCase() || 'GET';
    const path = url.pathname;

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (method === 'GET' && path === '/health') {
      const stats = await this.options.scheduleStore.getStats();
      await this.options.healthController.handleHealth(response, stats.active);
      return;
    }

    if (method === 'GET' && path === '/ready') {
      await this.options.healthController.handleReady(response);
      return;
    }

    if (method === 'POST' && path === '/messages') {
      await this.options.messageController.handleMessage(request, response);
      return;
    }

    if (path === '/schedules' && method === 'GET') {
      await this.options.scheduleController.handleList(request, response);
      return;
    }

    if (path === '/schedules' && method === 'POST') {
      await this.options.scheduleController.handleCreate(request, response);
      return;
    }

    const detailMatch = path.match(/^\/schedules\/([^/]+)$/);
    if (detailMatch) {
      const scheduleId = decodeURIComponent(detailMatch[1]);
      if (method === 'GET') {
        await this.options.scheduleController.handleGet(scheduleId, response);
        return;
      }
      if (method === 'PUT') {
        await this.options.scheduleController.handleUpdate(scheduleId, request, response);
        return;
      }
      if (method === 'DELETE') {
        await this.options.scheduleController.handleDelete(scheduleId, response);
        return;
      }
    }

    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify({ ok: false, error: `Route ${method} ${path} not found` }, null, 2)}\n`);
  }
}

export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}