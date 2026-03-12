import { randomBytes } from 'node:crypto';

export interface ModuleIntegrationLogger {
  info?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
}

export interface ModuleIntegrationSender {
  (config: {
    toModule?: string;
    action: string;
    payload: unknown;
    replyTo?: string;
    callbackTopic?: string;
    traceId?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<{ success: boolean; messageId: string; timestamp: string; error?: string } | null>;
}

export interface ModuleIntegrationPanelDefinition {
  name: string;
  url: string;
  description?: string;
  icon?: string;
  panelId?: string;
}

export interface ModuleIntegrationHelperOptions {
  moduleId: string;
  sendToBus: ModuleIntegrationSender;
  panel: ModuleIntegrationPanelDefinition;
  logger?: ModuleIntegrationLogger;
  timeoutMs?: number;
}

export class ModuleIntegrationHelper {
  private readonly moduleId: string;
  private readonly sendToBus: ModuleIntegrationSender;
  private readonly logger?: ModuleIntegrationLogger;
  private readonly timeoutMs: number;
  private readonly panelId: string;
  private readonly panelName: string;
  private readonly panelUrl: string;
  private readonly panelDescription?: string;
  private readonly panelIcon?: string;
  private readonly accessToken: string;

  constructor(options: ModuleIntegrationHelperOptions) {
    this.moduleId = options.moduleId;
    this.sendToBus = options.sendToBus;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.panelId = options.panel.panelId?.trim() || options.moduleId;
    this.panelName = options.panel.name.trim();
    this.panelUrl = options.panel.url.trim();
    this.panelDescription = options.panel.description?.trim() || undefined;
    this.panelIcon = options.panel.icon?.trim() || undefined;
    this.accessToken = randomBytes(24).toString('hex');

    if (!this.panelName) {
      throw new Error('Integration panel name is required');
    }

    if (!this.panelUrl) {
      throw new Error('Integration panel url is required');
    }
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  getPanelId(): string {
    return this.panelId;
  }

  getBaseUrl(): string {
    return this.panelUrl;
  }

  getSecuredUrl(): string {
    const url = new URL(this.panelUrl);
    url.searchParams.set('token', this.accessToken);
    return url.toString();
  }

  isAuthorized(url: URL): boolean {
    return url.searchParams.get('token') === this.accessToken;
  }

  async register(): Promise<void> {
    await this.safeSend('integration_panel_register', {
      panelId: this.panelId,
      name: this.panelName,
      url: this.panelUrl,
      token: this.accessToken,
      description: this.panelDescription,
      icon: this.panelIcon
    });
  }

  async unregister(): Promise<void> {
    await this.safeSend('integration_panel_unregister', {
      panelId: this.panelId
    });
  }

  private async safeSend(action: string, payload: unknown): Promise<void> {
    try {
      await this.sendToBus({
        toModule: 'platform',
        action,
        payload,
        replyTo: this.moduleId,
        timeoutMs: this.timeoutMs,
        context: {
          panelId: this.panelId
        }
      });
    } catch (error) {
      this.logger?.warn?.(`[ModuleIntegrationHelper] Failed to ${action} for ${this.panelId}:`, error);
    }
  }
}

export function createModuleIntegrationHelper(options: ModuleIntegrationHelperOptions): ModuleIntegrationHelper {
  return new ModuleIntegrationHelper(options);
}