import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScheduleController } from './controllers/ScheduleController.js';
import { HealthController } from './controllers/HealthController.js';
import { MessageController } from './controllers/MessageController.js';
import { ScheduleStore } from './models/ScheduleStore.js';
import { createRouter } from './routes/Router.js';
import { PanelServer } from './services/PanelServer.js';
import { SchedulerService } from './services/SchedulerService.js';
import type {
  CreateScheduleRequest,
  MessageEnvelope,
  ScheduleExecutionResult,
  ScheduleModuleConfig,
  UpdateScheduleRequest
} from './types/index.js';
import { getConfig } from './utils/Config.js';
import { createLogger } from './utils/Logger.js';

export class ScheduleApp {
  private readonly config: Awaited<ReturnType<typeof getConfig>>;
  private readonly logger;
  private readonly scheduleStore: ScheduleStore;
  private readonly scheduleController: ScheduleController;
  private readonly healthController: HealthController;
  private readonly messageController: MessageController;
  private readonly router: ReturnType<typeof createRouter>;
  private readonly panelServer: PanelServer;
  private readonly schedulerService: SchedulerService;
  private isStopping = false;
  private isInitialized = false;
  private readonly routePrefix: string;

  constructor(config: ScheduleModuleConfig, options?: { moduleRoot?: string; routePrefix?: string }) {
    this.config = config as Awaited<ReturnType<typeof getConfig>>;
    this.logger = createLogger(this.config.logLevel);
    this.routePrefix = options?.routePrefix || '/plugin/schedule';

    const moduleRoot = options?.moduleRoot || resolve(fileURLToPath(new URL('..', import.meta.url)));

    const dataDir = isAbsolute(this.config.dataDir)
      ? this.config.dataDir
      : resolve(moduleRoot, this.config.dataDir);

    this.scheduleStore = new ScheduleStore(dataDir, this.config.claimTimeoutMs);
    this.scheduleController = new ScheduleController(this.scheduleStore);
    this.healthController = new HealthController('0.1.0');
    this.messageController = new MessageController('schedule', {
      messageBusURL: this.config.messageBusURL,
      autoSubscribe: true
    });
    this.router = createRouter({
      healthController: this.healthController,
      messageController: this.messageController,
      scheduleController: this.scheduleController,
      scheduleStore: this.scheduleStore
    });
    this.schedulerService = new SchedulerService(
      this.scheduleStore,
      async (schedule) => {
        const replyEnvelope = await this.messageController.requestFromBus({
          toModule: 'platform-core',
          action: 'submit_user_message',
          payload: {
            message: schedule.message,
            systemPrompt: schedule.systemPrompt,
            model: schedule.model,
            claudeSessionId: schedule.claudeSessionId,
            workingDirectory: schedule.workingDirectory
          },
          replyTo: 'schedule',
          timeoutMs: 120000,
          context: {
            sessionId: schedule.sessionId,
            scheduleId: schedule.id,
            scheduleTitle: schedule.title,
            sourceType: schedule.sourceType
          }
        });

        return this.normalizeScheduleExecutionResult(replyEnvelope);
      },
      this.logger,
      this.config.scanIntervalMs
    );
    this.panelServer = new PanelServer(`${this.routePrefix}/api`);

    this.setupMessageHandlers();
  }

  async start(): Promise<void> {
    await this.initialize();
    await this.router.listen(this.config.port, this.config.host);
    this.setupGracefulShutdown();

    this.logger.info(`Schedule API started on ${this.getApiBaseUrl()}`);
  }

  async stop(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    this.isStopping = true;
    this.schedulerService.stop();

    this.messageController.shutdown();
    await this.router.close();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.scheduleStore.initialize();
    this.schedulerService.start();
    this.isInitialized = true;
  }

  async handleHttpRequest(subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<boolean> {
    await this.initialize();

    const pathOnly = subPath.split('?')[0] || '/';
    if (pathOnly === '/' || pathOnly === '/index.html') {
      await this.panelServer.render(response);
      return true;
    }

    if (pathOnly.startsWith('/api')) {
      const rewrittenPath = subPath.replace(/^\/api(?=\/|$)/, '') || '/';
      await this.router.handle(request, response, rewrittenPath);
      return true;
    }

    return false;
  }

  private setupMessageHandlers(): void {
    this.messageController.registerHandler('create_schedule', async (envelope) => {
      return this.scheduleStore.create(envelope.payload as CreateScheduleRequest);
    });

    this.messageController.registerHandler('list_schedules', async (envelope) => {
      const payload = envelope.payload as { status?: 'active' | 'paused' | 'completed' | 'failed'; sourceType?: 'delay' | 'cron' };
      return this.scheduleStore.list(payload);
    });

    this.messageController.registerHandler('get_schedule', async (envelope) => {
      const payload = envelope.payload as { scheduleId?: string };
      if (!payload.scheduleId) {
        throw new Error('scheduleId is required');
      }
      return this.scheduleStore.getById(payload.scheduleId);
    });

    this.messageController.registerHandler('update_schedule', async (envelope) => {
      const payload = envelope.payload as UpdateScheduleRequest;
      if (!payload.scheduleId) {
        throw new Error('scheduleId is required');
      }
      return this.scheduleStore.update(payload);
    });

    this.messageController.registerHandler('delete_schedule', async (envelope) => {
      const payload = envelope.payload as { scheduleId?: string };
      if (!payload.scheduleId) {
        throw new Error('scheduleId is required');
      }
      return {
        deleted: await this.scheduleStore.delete(payload.scheduleId),
        scheduleId: payload.scheduleId
      };
    });
  }

  private normalizeScheduleExecutionResult(replyEnvelope: MessageEnvelope): { success: boolean; result?: ScheduleExecutionResult; error?: string } {
    if (replyEnvelope.action === 'error') {
      const payload = replyEnvelope.payload as { error?: unknown } | undefined;
      return {
        success: false,
        error: typeof payload?.error === 'string' ? payload.error : JSON.stringify(payload?.error ?? 'Unknown error')
      };
    }

    const outerPayload = replyEnvelope.payload as { result?: unknown; error?: unknown } | undefined;
    if (outerPayload?.error !== undefined) {
      return {
        success: false,
        error: typeof outerPayload.error === 'string' ? outerPayload.error : JSON.stringify(outerPayload.error)
      };
    }

    const maybeEnvelope = outerPayload?.result;
    if (this.isMessageEnvelope(maybeEnvelope)) {
      const nestedPayload = maybeEnvelope.payload as { result?: ScheduleExecutionResult; error?: unknown } | undefined;
      if (nestedPayload?.error !== undefined) {
        return {
          success: false,
          error: typeof nestedPayload.error === 'string' ? nestedPayload.error : JSON.stringify(nestedPayload.error)
        };
      }

      return {
        success: true,
        result: nestedPayload?.result
      };
    }

    return {
      success: true,
      result: maybeEnvelope as ScheduleExecutionResult
    };
  }

  private isMessageEnvelope(value: unknown): value is MessageEnvelope {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<MessageEnvelope>;
    return typeof candidate.messageId === 'string'
      && typeof candidate.traceId === 'string'
      && typeof candidate.fromModule === 'string'
      && typeof candidate.toModule === 'string'
      && typeof candidate.action === 'string'
      && typeof candidate.replyTo === 'string'
      && typeof candidate.createdAt === 'string';
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`[schedule] Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
  }

  private getApiBaseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }
}

async function main(): Promise<void> {
  const config = await getConfig();
  const app = new ScheduleApp(config);
  await app.start();
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error('Failed to start Schedule Module:', error);
    process.exit(1);
  });
}

export async function createPlugin(context: {
  modulePath: string;
  routePrefix: string;
  config: Record<string, unknown>;
}): Promise<{
  initialize: () => Promise<void>;
  dispose: () => Promise<void>;
  handleHttpRequest: (subPath: string, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<boolean>;
  getMetadata: () => { displayName: string; description: string; hasUi: true; homePath: string };
}> {
  const app = new ScheduleApp(context.config as ScheduleModuleConfig, {
    moduleRoot: context.modulePath,
    routePrefix: context.routePrefix
  });

  return {
    initialize: async () => {
      await app.initialize();
    },
    dispose: async () => {
      await app.stop();
    },
    handleHttpRequest: async (subPath, request, response) => app.handleHttpRequest(subPath, request, response),
    getMetadata: () => ({
      displayName: 'Schedule 定时任务面板',
      description: '延迟任务与周期任务管理插件',
      hasUi: true,
      homePath: '/'
    })
  };
}