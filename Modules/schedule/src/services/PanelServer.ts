import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

export class PanelServer {
  private readonly htmlPath: string;

  constructor(private readonly apiBaseUrl: string) {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    this.htmlPath = join(__dirname, '../../public/panel.html');
  }

  async render(response: ServerResponse): Promise<void> {
    const html = await readFile(this.htmlPath, 'utf-8');
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html.replace('__SCHEDULE_API_BASE__', this.apiBaseUrl));
  }
}