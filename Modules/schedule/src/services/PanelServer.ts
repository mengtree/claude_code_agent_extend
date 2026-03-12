import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ModuleIntegrationHelper } from '@agent-platform/module-integration-helper';

export class PanelServer {
  private server: Server | null = null;
  private integrationHelper: ModuleIntegrationHelper | null = null;
  private actualPort: number | null = null;
  private readonly htmlPath: string;

  constructor(private readonly apiBaseUrl: string) {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    this.htmlPath = join(__dirname, '../../public/panel.html');
  }

  setIntegrationHelper(helper: ModuleIntegrationHelper): void {
    this.integrationHelper = helper;
  }

  async listen(port: number, host: string): Promise<void> {
    if (this.server) {
      await this.close();
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request.url || '/', response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => {
        const address = this.server?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve panel server address'));
          return;
        }

        this.actualPort = address.port;
        resolve();
      });
    });
  }

  getBaseUrl(host: string): string {
    if (this.actualPort === null) {
      throw new Error('Panel server has not started');
    }
    return `http://${host}:${this.actualPort}`;
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = null;
    this.actualPort = null;
  }

  private async handleRequest(rawUrl: string, response: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(rawUrl, 'http://127.0.0.1');

    if (!this.integrationHelper) {
      response.statusCode = 503;
      response.end('Panel is not ready');
      return;
    }

    if (!this.integrationHelper.isAuthorized(url)) {
      response.statusCode = 403;
      response.end('Forbidden');
      return;
    }

    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }

    const html = await readFile(this.htmlPath, 'utf-8');
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html.replace('__SCHEDULE_API_BASE__', this.apiBaseUrl));
  }
}