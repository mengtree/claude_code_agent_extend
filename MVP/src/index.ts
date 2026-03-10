import { cwd } from 'node:process';
import { ClaudeCliService, injectWorkspaceSystemPrompt } from './ClaudeCliService';
import { AgentRuntime } from './AgentRuntime';
import { HttpApiServer } from './HttpApiServer';
import { IntentParser } from './IntentParser';
import { ScheduleService } from './ScheduleService';
import { SessionManager } from './SessionManager';
import { Storage } from './Storage';
import { TaskQueueService } from './TaskQueueService';
import { normalizeWorkspacePath } from './WorkspacePath';

interface CommandLineOptions {
  command?: string;
  task?: string;
  message?: string;
  systemPrompt?: string;
  model?: string;
  resumeSessionId?: string;
  workingDirectory?: string;
  timeoutMs?: number;
  sessionId?: string;
  externalSource?: string;
  externalConversationId?: string;
  taskId?: string;
  scheduleId?: string;
  pollMs?: number;
  once?: boolean;
  limit?: number;
  purgeClaudeSession?: boolean;
  port?: number;
  noWorker?: boolean;
}

interface RuntimeServices {
  storage: Storage;
  claudeCliService: ClaudeCliService;
  sessionManager: SessionManager;
  taskQueueService: TaskQueueService;
  scheduleService: ScheduleService;
  intentParser: IntentParser;
  runtime: AgentRuntime;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const workspacePath = normalizeWorkspacePath(options.workingDirectory ?? cwd());

  if (!options.command && options.task) {
    await runLegacyTaskMode(options, workspacePath);
    return;
  }

  if (!options.command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const services = createRuntimeServices(workspacePath);

  switch (options.command) {
    case 'send':
      await runSendCommand(services.runtime, options);
      return;
    case 'serve':
      await runServeCommand(services.runtime, options);
      return;
    case 'sessions':
      await runSessionsCommand(options, workspacePath);
      return;
    case 'tasks':
      await runTasksCommand(options, workspacePath);
      return;
    case 'schedules':
      await runSchedulesCommand(options, workspacePath);
      return;
    case 'push':
      await runPushCommand(services.runtime, options);
      return;
    case 'http':
      await runHttpCommand(services, options);
      return;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default:
      throw new Error(`Unknown command: ${options.command}`);
  }
}

function createRuntimeServices(workspacePath: string): RuntimeServices {
  const storage = new Storage(workspacePath);
  const claudeCliService = new ClaudeCliService();
  const sessionManager = new SessionManager(storage, workspacePath);
  const taskQueueService = new TaskQueueService(storage);
  const scheduleService = new ScheduleService(storage);
  const intentParser = new IntentParser(claudeCliService);
  const runtime = new AgentRuntime(
    storage,
    sessionManager,
    taskQueueService,
    scheduleService,
    intentParser,
    claudeCliService,
    workspacePath
  );

  return {
    storage,
    claudeCliService,
    sessionManager,
    taskQueueService,
    scheduleService,
    intentParser,
    runtime
  };
}

async function runLegacyTaskMode(options: CommandLineOptions, workspacePath: string): Promise<void> {
  const service = new ClaudeCliService();
  const response = await service.execute({
    task: options.task!,
    systemPrompt: injectWorkspaceSystemPrompt(options.systemPrompt, workspacePath),
    model: options.model,
    resumeSessionId: options.resumeSessionId,
    workingDirectory: workspacePath,
    timeoutMs: options.timeoutMs
  });

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

async function runSendCommand(runtime: AgentRuntime, options: CommandLineOptions): Promise<void> {
  if (!options.message) {
    throw new Error('The send command requires --message.');
  }

  const reply = await runtime.handleIncomingMessage({
    message: options.message,
    sessionId: options.sessionId,
    externalSource: options.externalSource,
    externalConversationId: options.externalConversationId
  });

  process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
}

async function runServeCommand(runtime: AgentRuntime, options: CommandLineOptions): Promise<void> {
  const pollMs = options.pollMs ?? 2000;

  if (options.once) {
    await runtime.drainUntilIdle(pollMs);
    process.stdout.write('Queue drained.\n');
    return;
  }

  process.stdout.write(`Worker started. Poll interval: ${pollMs}ms\n`);
  await runtime.runWorkerLoop(pollMs);
}

async function runHttpCommand(services: RuntimeServices, options: CommandLineOptions): Promise<void> {
  const port = options.port ?? 3000;
  const workspacePath = normalizeWorkspacePath(options.workingDirectory ?? cwd());
  const server = new HttpApiServer(
    services.runtime,
    services.sessionManager,
    services.taskQueueService,
    services.scheduleService,
    workspacePath
  );

  if (!options.noWorker) {
    void services.runtime.runWorkerLoop(options.pollMs ?? 2000);
  }

  await server.listen(port);
  process.stdout.write(`HTTP API started at http://127.0.0.1:${port}\n`);
  await new Promise<void>(() => {
    // Keep the process alive while the server is running.
  });
}

async function runSessionsCommand(options: CommandLineOptions, workspacePath: string): Promise<void> {
  const storage = new Storage(workspacePath);
  const sessionManager = new SessionManager(storage, workspacePath);
  const subcommand = options.task || options.message || 'list';

  switch (subcommand) {
    case 'list': {
      const sessions = await sessionManager.listSessions();
      process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
      return;
    }
    case 'delete': {
      if (!options.sessionId) {
        throw new Error('sessions delete requires --session.');
      }

      await sessionManager.deleteSession(options.sessionId, options.purgeClaudeSession ?? true);
      process.stdout.write(`Session ${options.sessionId} deleted.\n`);
      return;
    }
    case 'clear': {
      if (!options.sessionId) {
        throw new Error('sessions clear requires --session.');
      }

      const session = await sessionManager.clearSession(options.sessionId, options.purgeClaudeSession ?? true);
      process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`Unknown sessions subcommand: ${subcommand}`);
  }
}

async function runTasksCommand(options: CommandLineOptions, workspacePath: string): Promise<void> {
  if (!options.sessionId) {
    throw new Error('tasks command requires --session.');
  }

  const storage = new Storage(workspacePath);
  const taskQueueService = new TaskQueueService(storage);
  const subcommand = options.task || options.message || 'list';

  switch (subcommand) {
    case 'list': {
      const tasks = await taskQueueService.list(options.sessionId);
      process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
      return;
    }
    case 'remove': {
      if (!options.taskId) {
        throw new Error('tasks remove requires --taskId.');
      }

      const removedTask = await taskQueueService.removeQueuedTask(options.sessionId, options.taskId);
      process.stdout.write(`${JSON.stringify(removedTask ?? null, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`Unknown tasks subcommand: ${subcommand}`);
  }
}

async function runSchedulesCommand(options: CommandLineOptions, workspacePath: string): Promise<void> {
  const storage = new Storage(workspacePath);
  const scheduleService = new ScheduleService(storage);
  const subcommand = options.task || options.message || 'list';

  switch (subcommand) {
    case 'list': {
      const schedules = await scheduleService.list(options.sessionId);
      process.stdout.write(`${JSON.stringify(schedules, null, 2)}\n`);
      return;
    }
    case 'remove': {
      if (!options.sessionId) {
        throw new Error('schedules remove requires --session.');
      }

      if (!options.scheduleId) {
        throw new Error('schedules remove requires --scheduleId.');
      }

      const removed = await scheduleService.remove(options.sessionId, options.scheduleId);
      process.stdout.write(`${JSON.stringify({ removed }, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`Unknown schedules subcommand: ${subcommand}`);
  }
}

async function runPushCommand(runtime: AgentRuntime, options: CommandLineOptions): Promise<void> {
  const messages = await runtime.listPushMessages(options.limit ?? 20, options.sessionId);
  process.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
}

function parseArguments(argumentsList: string[]): CommandLineOptions {
  const options: CommandLineOptions = {
    purgeClaudeSession: true
  };

  if (argumentsList.length > 0 && !argumentsList[0].startsWith('--')) {
    options.command = argumentsList[0];
  }

  for (let index = 0; index < argumentsList.length; index += 1) {
    const current = argumentsList[index];
    const next = argumentsList[index + 1];

    switch (current) {
      case 'send':
      case 'serve':
      case 'sessions':
      case 'tasks':
      case 'push':
      case 'schedules':
      case 'http':
      case 'help':
        options.command = current;
        break;
      case '--task':
        options.task = next;
        index += 1;
        break;
      case '--message':
        options.message = next;
        index += 1;
        break;
      case '--system':
        options.systemPrompt = next;
        index += 1;
        break;
      case '--model':
        options.model = next;
        index += 1;
        break;
      case '--resume':
        options.resumeSessionId = next;
        index += 1;
        break;
      case '--cwd':
        options.workingDirectory = next;
        index += 1;
        break;
      case '--timeoutMs':
        options.timeoutMs = next ? Number.parseInt(next, 10) : undefined;
        index += 1;
        break;
      case '--session':
        options.sessionId = next;
        index += 1;
        break;
      case '--source':
        options.externalSource = next;
        index += 1;
        break;
      case '--conversation':
        options.externalConversationId = next;
        index += 1;
        break;
      case '--taskId':
        options.taskId = next;
        index += 1;
        break;
      case '--scheduleId':
        options.scheduleId = next;
        index += 1;
        break;
      case '--pollMs':
        options.pollMs = next ? Number.parseInt(next, 10) : undefined;
        index += 1;
        break;
      case '--limit':
        options.limit = next ? Number.parseInt(next, 10) : undefined;
        index += 1;
        break;
      case '--port':
        options.port = next ? Number.parseInt(next, 10) : undefined;
        index += 1;
        break;
      case '--once':
        options.once = true;
        break;
      case '--no-worker':
        options.noWorker = true;
        break;
      case '--keep-claude':
        options.purgeClaudeSession = false;
        break;
      case '--help':
      case '-h':
        options.command = 'help';
        break;
      default:
        if (
          !current.startsWith('--') &&
          !options.task &&
          (options.command === 'sessions' || options.command === 'tasks' || options.command === 'schedules')
        ) {
          options.task = current;
        }
        break;
    }
  }

  return options;
}

function printUsage(): void {
  const usage = [
    'Usage:',
    '  node dist/index.js --task "direct Claude task" [--resume session-id]',
    '  node dist/index.js send --message "user message" [--session local-session-id] [--source im] [--conversation conv-1]',
    '  node dist/index.js serve [--pollMs 2000] [--once]',
    '  node dist/index.js sessions list',
    '  node dist/index.js sessions delete --session local-session-id',
    '  node dist/index.js sessions clear --session local-session-id',
    '  node dist/index.js tasks list --session local-session-id',
    '  node dist/index.js tasks remove --session local-session-id --taskId task-id',
    '  node dist/index.js schedules list [--session local-session-id]',
    '  node dist/index.js schedules remove --session local-session-id --scheduleId schedule-id',
    '  node dist/index.js push [--session local-session-id] [--limit 20]',
    '  node dist/index.js http [--port 3000] [--pollMs 2000] [--no-worker]',
    '',
    'Notes:',
    '  1. Claude CLI always runs in the current workspace directory, so project-level skills and config stay local to this app directory.',
    '  2. send only enqueues or controls work; serve or http worker mode is responsible for asynchronous execution and active push output.'
  ].join('\n');

  process.stdout.write(`${usage}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});