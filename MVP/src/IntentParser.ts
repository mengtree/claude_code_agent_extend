import { AgentSession, IntentParseResult, SessionTask } from './types';
import { ClaudeCliService } from './ClaudeCliService';
import { DebugLogger } from './DebugLogger';
import { ExpressionParser } from './skills/ExpressionParser';
import { TextTransformer } from './skills/text-transformer';

const INTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['enqueue_task', 'list_tasks', 'remove_task', 'interrupt', 'clear_session', 'calculate', 'transform_text']
    },
    acknowledgement: { type: 'string' },
    taskContent: { type: 'string' },
    taskSummary: { type: 'string' },
    taskId: { type: 'string' },
    expression: { type: 'string' },
    transformType: { type: 'string' },
    textToTransform: { type: 'string' },
    priority: {
      type: 'string',
      enum: ['normal', 'urgent']
    }
  },
  required: ['intent', 'acknowledgement', 'priority']
};

export class IntentParser {
  private readonly expressionParser: ExpressionParser;

  constructor(private readonly claudeCliService: ClaudeCliService) {
    this.expressionParser = new ExpressionParser();
  }

  async parse(message: string, session: AgentSession, tasks: SessionTask[]): Promise<IntentParseResult> {
    const fastPathIntent = this.tryParseFastPath(message, tasks);

    if (fastPathIntent) {
      DebugLogger.info('intent.fast_path', {
        sessionId: session.id,
        intent: fastPathIntent.intent,
        priority: fastPathIntent.priority,
        taskId: fastPathIntent.taskId,
        taskSummary: fastPathIntent.taskSummary
      });
      return fastPathIntent;
    }

    try {
      const response = await this.claudeCliService.execute({
        task: this.buildPrompt(message, session, tasks),
        workingDirectory: session.workspacePath,
        timeoutMs: 45000,
        noSessionPersistence: true,
        jsonSchema: INTENT_SCHEMA
      });

      const parsedIntent = this.normalizeParsedIntent(JSON.parse(response.result) as Partial<IntentParseResult>, message, tasks);
      DebugLogger.info('intent.parsed', {
        sessionId: session.id,
        mode: 'claude',
        intent: parsedIntent.intent,
        priority: parsedIntent.priority,
        taskId: parsedIntent.taskId,
        taskSummary: parsedIntent.taskSummary
      });
      return parsedIntent;
    } catch (error) {
      const fallbackIntent = this.fallbackParse(message, tasks);
      DebugLogger.warn('intent.fallback', {
        sessionId: session.id,
        reason: error instanceof Error ? error.message : String(error),
        intent: fallbackIntent.intent,
        priority: fallbackIntent.priority,
        taskId: fallbackIntent.taskId,
        taskSummary: fallbackIntent.taskSummary
      });
      return fallbackIntent;
    }
  }

  private tryParseFastPath(message: string, tasks: SessionTask[]): IntentParseResult | undefined {
    const parsed = this.fallbackParse(message, tasks);
    return parsed.intent === 'enqueue_task' ? undefined : parsed;
  }

  private buildPrompt(message: string, session: AgentSession, tasks: SessionTask[]): string {
    const queuedTasks = tasks
      .filter((task) => task.status === 'queued' || task.status === 'running')
      .map((task) => `${task.id} | ${task.status} | ${task.priority} | ${task.summary}`)
      .join('\n');

    return [
      '你是一个任务调度意图解析器。',
      '你的目标是把用户输入解析成任务队列操作。',
      '规则：',
      '1. 默认把普通请求解析为 enqueue_task。',
      '2. 如果用户想查看队列，返回 list_tasks。',
      '3. 如果用户想移除某个任务，返回 remove_task，并尽量识别 taskId。',
      '4. 如果用户要求中断、停止、取消当前执行，返回 interrupt。',
      '5. 如果用户要求清空上下文、清空会话、/clear，返回 clear_session。',
      '6. 如果用户要求进行数学计算（如算术表达式），返回 calculate，并提供 expression 字段。',
      '7. 如果用户要求进行文本转换（如转大写、转小写、反转、统计等），返回 transform_text，并提供 transformType 和 textToTransform 字段。',
      '8. 如果用户表示紧急、优先、马上处理，则 priority 使用 urgent。',
      '9. acknowledgement 必须是给终端用户的中文简短回复，语气自然，结合当前输入内容，不要机械重复固定模板。',
      '10. 对于 enqueue_task，如果没有识别出特殊意图，taskContent 必须保持用户输入原文，不要改写、润色、补全或翻译。',
      '11. 对于 enqueue_task，taskSummary 应该是 8 到 20 个字以内的中文摘要。',
      '',
      '支持的文本转换类型 (transformType):',
      '  - uppercase: 转大写',
      '  - lowercase: 转小写',
      '  - capitalize: 首字母大写',
      '  - reverse: 反转文本',
      '  - strip_spaces: 去除空格',
      '  - count_chars: 统计字符数',
      '  - count_words: 统计单词数',
      '  - remove_duplicates: 去除重复字符',
      '',
      `当前会话: ${session.id}`,
      '当前排队任务:',
      queuedTasks || '无',
      '',
      '用户输入:',
      message
    ].join('\n');
  }

  private normalizeParsedIntent(
    parsed: Partial<IntentParseResult>,
    originalMessage: string,
    tasks: SessionTask[]
  ): IntentParseResult {
    const parsedAcknowledgement = this.normalizeAcknowledgement(parsed.acknowledgement);

    if (!parsed.intent || !parsed.priority) {
      const fallbackIntent = this.fallbackParse(originalMessage, tasks);
      return {
        ...fallbackIntent,
        acknowledgement: parsedAcknowledgement || fallbackIntent.acknowledgement
      };
    }

    const fallbackIntent = this.needsFallbackFields(parsed)
      ? this.fallbackParse(originalMessage, tasks)
      : undefined;

    return {
      intent: parsed.intent,
      acknowledgement: parsedAcknowledgement || fallbackIntent?.acknowledgement || this.buildMinimalAcknowledgement(parsed.intent, originalMessage),
      taskContent: parsed.intent === 'enqueue_task'
        ? originalMessage
        : parsed.taskContent || fallbackIntent?.taskContent || originalMessage,
      taskSummary: parsed.taskSummary || fallbackIntent?.taskSummary || this.summarize(originalMessage),
      taskId: parsed.taskId || fallbackIntent?.taskId,
      expression: parsed.expression || fallbackIntent?.expression,
      transformType: parsed.transformType || fallbackIntent?.transformType,
      textToTransform: parsed.textToTransform || fallbackIntent?.textToTransform,
      priority: parsed.priority
    };
  }

  private needsFallbackFields(parsed: Partial<IntentParseResult>): boolean {
    return !parsed.taskContent || !parsed.taskSummary || (!parsed.taskId && parsed.intent === 'remove_task');
  }

  private normalizeAcknowledgement(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private fallbackParse(message: string, tasks: SessionTask[]): IntentParseResult {
    const trimmedMessage = message.trim();
    const removeMatch = trimmedMessage.match(/(?:remove|delete|cancel|移除任务|删除任务)\s+([a-f0-9-]{8,})/i);

    // 检查是否是计算请求
    if (this.expressionParser.isMathExpression(trimmedMessage)) {
      const expression = this.extractExpression(trimmedMessage);
      return {
        intent: 'calculate',
        acknowledgement: '我来帮你计算这个表达式。',
        expression: expression || trimmedMessage,
        priority: 'normal'
      };
    }

    // 检查是否是文本转换请求
    if (TextTransformer.isMatch(trimmedMessage)) {
      const transformResult = this.extractTransformRequest(trimmedMessage);
      if (transformResult) {
        return {
          intent: 'transform_text',
          acknowledgement: this.buildTransformAcknowledgement(transformResult.transformType),
          transformType: transformResult.transformType,
          textToTransform: transformResult.text,
          priority: 'normal'
        };
      }
    }

    if (/^\/clear$/i.test(trimmedMessage) || /清空会话|清除会话|重置会话/.test(trimmedMessage)) {
      return {
        intent: 'clear_session',
        acknowledgement: '好的，我会把这个会话的上下文和本地队列一起清空。',
        priority: 'urgent'
      };
    }

    if (/^\/(tasks|queue)$/i.test(trimmedMessage) || /查看任务|任务列表|队列列表|查看队列/.test(trimmedMessage)) {
      return {
        intent: 'list_tasks',
        acknowledgement: tasks.length > 0
          ? `我先把当前队列整理给你看，现在一共有 ${tasks.length} 个任务。`
          : '当前这个会话里还没有排队任务，我给你看一下空队列。',
        priority: 'normal'
      };
    }

    if (removeMatch) {
      return {
        intent: 'remove_task',
        acknowledgement: `收到，我会尝试把任务 ${removeMatch[1]} 从当前队列里移除。`,
        taskId: removeMatch[1],
        priority: 'urgent'
      };
    }

    if (/^\/(interrupt|stop)$/i.test(trimmedMessage) || /中断|停止当前任务|立刻停止|马上停止/.test(trimmedMessage)) {
      return {
        intent: 'interrupt',
        acknowledgement: '收到，我会优先中断当前正在执行的任务。',
        priority: 'urgent'
      };
    }

    return {
      intent: 'enqueue_task',
      acknowledgement: this.buildMinimalAcknowledgement('enqueue_task', trimmedMessage),
      taskContent: message,
      taskSummary: this.summarize(trimmedMessage),
      priority: /紧急|优先|马上|尽快/.test(trimmedMessage) ? 'urgent' : 'normal'
    };
  }

  private summarize(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    return normalized.length <= 20 ? normalized : `${normalized.slice(0, 20)}...`;
  }

  private buildMinimalAcknowledgement(intent: IntentParseResult['intent'], message: string): string {
    const preview = this.toPreview(message);

    switch (intent) {
      case 'list_tasks':
        return '我先把当前任务队列整理给你。';
      case 'remove_task':
        return '收到，我来处理这个任务移除请求。';
      case 'interrupt':
        return '收到，我会先尝试中断当前任务。';
      case 'clear_session':
        return '收到，我会清空当前会话。';
      case 'calculate':
        return `我来算一下”${preview}”。`;
      case 'transform_text':
        return `我来帮你处理这个文本转换。`;
      case 'enqueue_task':
      default:
        return `收到，我先处理”${preview}”。`;
    }
  }

  private toPreview(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    return normalized.length <= 24 ? normalized : `${normalized.slice(0, 24)}...`;
  }

  /**
   * 从消息中提取数学表达式
   */
  private extractExpression(message: string): string | null {
    // 匹配数学表达式模式
    const patterns = [
      /计算\s*[:：]?\s*([\d+\-*/%^().\s×÷]+)/,
      /算\s*[:：]?\s*([\d+\-*/%^().\s×÷]+)/,
      /([\d+\-*/%^().\s×÷]{5,})/,
      /(?:求|等于|是)\s*([\d+\-*/%^().\s×÷]+)/
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // 如果整个消息看起来像表达式，返回整个消息
    const cleaned = message.replace(/^(计算|算|求|等于|是|帮我计算|请计算|帮我算)[：:\s]*/, '').trim();
    if (this.expressionParser.isMathExpression(cleaned)) {
      return cleaned;
    }

    return null;
  }

  /**
   * 从消息中提取文本转换请求
   */
  private extractTransformRequest(message: string): { transformType: string; text: string } | null {
    const transformPatterns = [
      { type: 'uppercase', patterns: [/转大写\s*[:：]?\s*(.+)/, /uppercase\s*[:：]?\s*(.+)/i] },
      { type: 'lowercase', patterns: [/转小写\s*[:：]?\s*(.+)/, /lowercase\s*[:：]?\s*(.+)/i] },
      { type: 'capitalize', patterns: [/首字母大写\s*[:：]?\s*(.+)/, /capitalize\s*[:：]?\s*(.+)/i] },
      { type: 'reverse', patterns: [/反转\s*[:：]?\s*(.+)/, /reverse\s*[:：]?\s*(.+)/i] },
      { type: 'strip_spaces', patterns: [/去除空格\s*[:：]?\s*(.+)/, /strip.?spaces?\s*[:：]?\s*(.+)/i] },
      { type: 'count_chars', patterns: [/统计字符\s*[:：]?\s*(.+)/, /字符数\s*[:：]?\s*(.+)/, /count\s+chars?\s*[:：]?\s*(.+)/i] },
      { type: 'count_words', patterns: [/统计单词\s*[:：]?\s*(.+)/, /单词数\s*[:：]?\s*(.+)/, /count\s+words?\s*[:：]?\s*(.+)/i] },
      { type: 'remove_duplicates', patterns: [/去重\s*[:：]?\s*(.+)/, /remove\s+duplicates?\s*[:：]?\s*(.+)/i] }
    ];

    for (const { type, patterns } of transformPatterns) {
      for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          return {
            transformType: type,
            text: match[1].trim()
          };
        }
      }
    }

    // 如果只是简单的关键词，提取引号内的文本
    const quotedTextMatch = message.match(/['""](.+?)['""]/);
    const text = quotedTextMatch ? quotedTextMatch[1] : message.replace(/^(转大写|转小写|首字母大写|反转|去除空格|统计字符|统计单词|去重|uppercase|lowercase|capitalize|reverse|strip\s*spaces?|count\s*chars?|count\s*words?|remove\s*duplicates?)[::\s]*/, '').trim();

    // 根据关键词推断转换类型
    if (/转大写|uppercase/i.test(message)) {
      return { transformType: 'uppercase', text };
    }
    if (/转小写|lowercase/i.test(message)) {
      return { transformType: 'lowercase', text };
    }
    if (/首字母大写|capitalize/i.test(message)) {
      return { transformType: 'capitalize', text };
    }
    if (/反转|reverse/i.test(message)) {
      return { transformType: 'reverse', text };
    }
    if (/去除空格|strip\s*space/i.test(message)) {
      return { transformType: 'strip_spaces', text };
    }
    if (/统计字符|字符数|count\s*char/i.test(message)) {
      return { transformType: 'count_chars', text };
    }
    if (/统计单词|单词数|count\s*word/i.test(message)) {
      return { transformType: 'count_words', text };
    }
    if (/去重|remove\s*duplicate/i.test(message)) {
      return { transformType: 'remove_duplicates', text };
    }

    return null;
  }

  /**
   * 构建文本转换的确认消息
   */
  private buildTransformAcknowledgement(transformType: string): string {
    const acknowledgements: Record<string, string> = {
      uppercase: '我来帮你把文本转换为大写。',
      lowercase: '我来帮你把文本转换为小写。',
      capitalize: '我来帮你把文本首字母大写。',
      reverse: '我来帮你反转这段文本。',
      strip_spaces: '我来帮你去除文本中的空格。',
      count_chars: '我来帮你统计文本的字符数。',
      count_words: '我来帮你统计文本的单词数。',
      remove_duplicates: '我来帮你去除文本中的重复字符。'
    };

    return acknowledgements[transformType] || '我来帮你处理这个文本转换。';
  }
}