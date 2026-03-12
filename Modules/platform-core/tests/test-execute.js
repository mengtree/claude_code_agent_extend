/**
 * 非流式查询测试脚本
 *
 * 使用方式：
 *   node tests/test-execute.js "你的问题"
 *
 * 示例：
 *   node tests/test-execute.js "解释什么是机器学习"
 *   node tests/test-execute.js "写一个快速排序算法"
 *   node tests/test-execute.js "分析以下代码的问题：function add(a, b) { return a + b; }"
 */

import { ClaudeSdkService } from '../dist/services/ClaudeSdkService.js';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  dim: '\x1b[2m'
};

/**
 * 执行非流式查询
 */
async function executeQuery(prompt, options = {}) {
  const { sessionId, systemPrompt, model } = options;

  const sdkService = new ClaudeSdkService();

  console.log(`${colors.cyan}${colors.bright}🚀 开始执行查询${colors.reset}\n`);
  console.log(`${colors.dim}────────────────────────────────────────${colors.reset}\n`);

  try {
    const startTime = Date.now();

    const response = await sdkService.execute({
      prompt,
      ...(sessionId && { sessionId }),
      ...(systemPrompt && { systemPrompt }),
      ...(model && { model })
    });

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // 显示结果
    console.log(`${colors.green}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.green}${colors.bright}📋 查询完成${colors.reset}`);
    console.log(`${colors.green}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

    // 显示响应内容
    if (response.ok) {
      console.log(`${colors.bright}${colors.cyan}✅ 查询成功${colors.reset}\n`);
      console.log(`${colors.dim}════════════════════════════════════════${colors.reset}`);
      console.log(`${colors.bright}响应内容:${colors.reset}\n`);
      console.log(response.result);
      console.log(`${colors.dim}════════════════════════════════════════${colors.reset}\n`);
    } else {
      console.log(`${colors.red}${colors.bright}❌ 查询失败${colors.reset}\n`);
      console.log(`${colors.yellow}${response.result}${colors.reset}\n`);
    }

    // 显示统计信息
    const stats = [];
    if (response.durationMs) stats.push(`⏱️  总耗时: ${response.durationMs}ms`);
    if (response.costUsd) stats.push(`💰 成本: $${response.costUsd.toFixed(6)}`);
    if (response.stopReason) stats.push(`🛑 停止原因: ${response.stopReason}`);
    if (response.sessionId) stats.push(`🔖 会话 ID: ${response.sessionId.slice(0, 8)}...`);

    if (stats.length > 0) {
      console.log(`${colors.cyan}${stats.join(' | ')}${colors.reset}\n`);
    }

    // 显示原始数据（可选）
    if (response.raw) {
      console.log(`${colors.dim}原始响应数据:${colors.reset}`);
      console.log(`${colors.dim}${JSON.stringify(response.raw, null, 2)}${colors.reset}\n`);
    }

    return response;

  } catch (error) {
    console.error(`\n${colors.red}❌ 执行失败:${colors.reset}`, error.message);
    console.error(`${colors.dim}错误堆栈:${colors.reset}`, error.stack);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  const prompt = process.argv[2];

  if (!prompt) {
    console.log(`${colors.yellow}用法: node tests/test-execute.js "你的问题"${colors.reset}`);
    console.log(`\n${colors.cyan}示例:${colors.reset}`);
    console.log(`  node tests/test-execute.js "你好"`);
    console.log(`  node tests/test-execute.js "解释什么是机器学习"`);
    console.log(`  node tests/test-execute.js "写一个快速排序算法"`);
    console.log(`  node tests/test-execute.js "分析3个机器学习算法的优缺点"`);
    console.log(`  node tests/test-execute.js "写一首关于AI的诗"`);
    console.log(`  node tests/test-execute.js "对比 Vue3 和 React 的区别"`);
    process.exit(1);
  }

  // 显示请求信息
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}  Claude SDK 非流式查询测试${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}📝 问题:${colors.reset} ${prompt}`);
  console.log(`${colors.dim}────────────────────────────────────────${colors.reset}\n`);

  try {
    // 执行查询
    const response = await executeQuery(prompt);

    // 显示总结
    console.log(`${colors.green}${colors.bright}✅ 测试完成${colors.reset}`);
    console.log(`${colors.dim}会话 ID: ${response.sessionId || 'N/A'}${colors.reset}`);
    console.log(`${colors.dim}可以保存此会话 ID 用于后续对话${colors.reset}\n`);

    // 如果有会话 ID，展示如何使用
    if (response.sessionId) {
      console.log(`${colors.cyan}提示: 使用以下命令继续此会话:${colors.reset}`);
      console.log(`${colors.dim}  node tests/test-execute.js "你的下一个问题" --session ${response.sessionId}${colors.reset}\n`);
    }

  } catch (error) {
    console.error(`${colors.red}✗ 错误:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// 解析命令行参数（支持 --session 和 --model 选项）
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  const promptArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session' && args[i + 1]) {
      options.sessionId = args[++i];
    } else if (args[i] === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (args[i] === '--system' && args[i + 1]) {
      options.systemPrompt = args[++i];
    } else if (!args[i].startsWith('--')) {
      promptArgs.push(args[i]);
    }
  }

  return { prompt: promptArgs.join(' '), options };
}

// 修改 main 函数以支持命令行选项
main = async function() {
  const { prompt, options } = parseArgs();

  if (!prompt) {
    console.log(`${colors.yellow}用法: node tests/test-execute.js "你的问题" [选项]${colors.reset}`);
    console.log(`\n${colors.cyan}选项:${colors.reset}`);
    console.log(`  --session <id>    继续之前的会话`);
    console.log(`  --model <name>    指定模型`);
    console.log(`  --system <prompt> 指定系统提示词`);
    console.log(`\n${colors.cyan}示例:${colors.reset}`);
    console.log(`  node tests/test-execute.js "你好"`);
    console.log(`  node tests/test-execute.js "解释什么是机器学习"`);
    console.log(`  node tests/test-execute.js "继续刚才的话题" --session abc123...`);
    console.log(`  node tests/test-execute.js "写一首诗" --model claude-3-5-sonnet-20241022`);
    process.exit(1);
  }

  // 显示请求信息
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}  Claude SDK 非流式查询测试${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}📝 问题:${colors.reset} ${prompt}`);
  if (options.sessionId) {
    console.log(`${colors.dim}🔖 会话 ID:${colors.reset} ${options.sessionId}`);
  }
  if (options.model) {
    console.log(`${colors.dim}🤖 模型:${colors.reset} ${options.model}`);
  }
  console.log(`${colors.dim}────────────────────────────────────────${colors.reset}\n`);

  try {
    // 执行查询
    const response = await executeQuery(prompt, options);

    // 显示总结
    console.log(`${colors.green}${colors.bright}✅ 测试完成${colors.reset}`);
    if (response.sessionId) {
      console.log(`${colors.dim}会话 ID: ${response.sessionId}${colors.reset}`);
      console.log(`${colors.dim}可以保存此会话 ID 用于后续对话${colors.reset}\n`);

      console.log(`${colors.cyan}提示: 使用以下命令继续此会话:${colors.reset}`);
      console.log(`${colors.dim}  node tests/test-execute.js "你的下一个问题" --session ${response.sessionId}${colors.reset}\n`);
    } else {
      console.log();
    }

  } catch (error) {
    console.error(`${colors.red}✗ 错误:${colors.reset}`, error.message);
    console.error(`${colors.dim}错误详情:${colors.reset}`, error);
    process.exit(1);
  }
};

// 运行
main();
