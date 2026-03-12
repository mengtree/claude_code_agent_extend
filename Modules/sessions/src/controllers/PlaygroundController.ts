/**
 * 测试页面控制器
 *
 * 提供静态文件服务
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import type { ModuleIntegrationHelper } from '@agent-platform/module-integration-helper';

/**
 * 测试页面控制器类
 */
export class PlaygroundController {
  private readonly htmlPath: string;
  private readonly integrationHelper: ModuleIntegrationHelper;

  constructor(integrationHelper: ModuleIntegrationHelper) {
    this.integrationHelper = integrationHelper;

    // 获取静态 HTML 文件路径 - 指向模块根目录的 public 文件夹
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    this.htmlPath = join(__dirname, '../../public/playground.html');
  }

  /**
   * 处理测试页请求（GET /, GET /playground）
   */
  async handlePage(url: URL, response: ServerResponse): Promise<void> {
    if (!this.integrationHelper.isAuthorized(url)) {
      response.statusCode = 403;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Forbidden');
      return;
    }

    try {
      const html = await readFile(this.htmlPath, 'utf-8');
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
    } catch (error) {
      console.error('Failed to read playground.html:', error);
      response.statusCode = 500;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Error loading playground page');
    }
  }
}
