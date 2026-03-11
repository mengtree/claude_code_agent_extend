/**
 * 流式查询测试脚本
 *
 * 使用方式：
 *   node tests/test-stream.js "你的问题"
 *
 * 示例：
 *   node tests/test-stream.js "解释什么是机器学习"
 *   node tests/test-stream.js "写一个快速排序算法"
 *   node tests/test-stream.js "分析以下代码的问题：function add(a, b) { return a + b; }"
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
 * 执行流式查询
 */
async function streamQuery(prompt, options = {}) {
  const { sessionId, systemPrompt } = options;

  const sdkService = new ClaudeSdkService();

  console.log(`${colors.cyan}${colors.bright}🌊 流式响应开始${colors.reset}\n`);
  console.log(`${colors.dim}────────────────────────────────────────${colors.reset}\n`);

  try {
    await sdkService.executeStream(
      {
        prompt,
        ...(sessionId && { sessionId }),
        ...(systemPrompt && { systemPrompt })
      },
      {
        // 通用消息回调
        async onMessage(message) {
          const timestamp = message.session_id ? ` [会话: ${message.session_id.slice(0, 8)}...]` : '';

          switch (message.type) {
            case 'user':
              console.log(`\n${colors.blue}[用户消息]${timestamp}${colors.reset}`);
              if (message.message?.content) {
                for (const block of message.message.content) {
                  if (block.type === 'text' && block.text) {
                    console.log(`${colors.dim}  ${block.text}${colors.reset}`);
                  }
                }
              }
              break;

            case 'assistant':
              // 助手消息 - 实时输出文本内容
              if (message.message?.content) {
                for (const block of message.message.content) {
                  if (block.type === 'text' && block.text) {
                    // 直接输出文本，不加换行，实现流式效果
                    process.stdout.write(block.text);
                  } else if (block.type === 'tool_use') {
                    console.log(`\n\n${colors.magenta}🔧 使用工具: ${block.name}${colors.reset}`);
                    if (block.input) {
                      console.log(`${colors.dim}  参数: ${JSON.stringify(block.input, null, 2).slice(0, 200)}...${colors.reset}`);
                    }
                  } else if (block.type === 'tool_result') {
                    console.log(`\n${colors.yellow}📦 工具结果: ${block.tool_use_id}${colors.reset}`);
                    if (block.content && block.content.length > 0) {
                      const resultText = block.content[0]?.text || '';
                      if (resultText) {
                        console.log(`${colors.dim}  ${resultText.slice(0, 200)}...${colors.reset}`);
                      }
                    }
                  }
                }
              }
              break;

            case 'system':
              if (message.subtype === 'init') {
                console.log(`${colors.green}✔${colors.reset} ${colors.dim}系统初始化完成${colors.reset}`);
                console.log(`${colors.dim}  模型: ${message.model}${colors.reset}`);
                console.log(`${colors.dim}  工具: ${message.tools?.join(', ') || '无'}${colors.reset}`);
                console.log(`${colors.dim}  会话: ${message.session_id}${colors.reset}`);
              }
              break;
          }
        },

        // 结果回调
        async onResult(message) {
          console.log(`\n\n${colors.green}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
          console.log(`${colors.green}${colors.bright}📋 查询完成${colors.reset}`);
          console.log(`${colors.green}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

          if (message.result && message.subtype === 'success') {
            // 如果有结果文本且之前没有流式输出过，显示结果
            // （通常流式查询已经在 onMessage 中输出了内容）
          }

          // 显示统计信息
          const stats = [];
          if (message.duration_ms) stats.push(`⏱️  ${message.duration_ms}ms`);
          if (message.duration_api_ms) stats.push(`API: ${message.duration_api_ms}ms`);
          if (message.total_cost_usd) stats.push(`💰 $${message.total_cost_usd.toFixed(6)}`);
          if (message.num_turns) stats.push(`🔄 ${message.num_turns} 轮`);
          if (message.stop_reason) stats.push(`🛑 ${message.stop_reason}`);

          if (stats.length > 0) {
            console.log(`${colors.cyan}${stats.join(' | ')}${colors.reset}`);
          }

          if (message.session_id) {
            console.log(`${colors.dim}会话 ID: ${message.session_id}${colors.reset}`);
          }
        },

        // 错误回调
        onError(error) {
          console.log(`\n${colors.red}❌ 错误: ${error.message}${colors.reset}`);
        }
      }
    );

    console.log(`\n${colors.green}${colors.bright}✅ 流式响应结束${colors.reset}\n`);

  } catch (error) {
    console.error(`\n${colors.red}✗ 执行失败:${colors.reset}`, error.message);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  const prompt = process.argv[2];

  if (!prompt) {
    console.log(`${colors.yellow}用法: node tests/test-stream.js "你的问题"${colors.reset}`);
    console.log(`\n${colors.cyan}示例:${colors.reset}`);
    console.log(`  node tests/test-stream.js "你好"`);
    console.log(`  node tests/test-stream.js "解释什么是机器学习"`);
    console.log(`  node tests/test-stream.js "写一个快速排序算法"`);
    console.log(`  node tests/test-stream.js "分析3个机器学习算法的优缺点"`);
    console.log(`  node tests/test-stream.js "写一首关于AI的诗"`);
    console.log(`  node tests/test-stream.js "对比 Vue3 和 React 的区别"`);
    process.exit(1);
  }

  // 显示请求信息
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}  Claude SDK 流式查询测试${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}📝 问题:${colors.reset} ${prompt}`);
  console.log(`${colors.dim}────────────────────────────────────────${colors.reset}\n`);

  try {
    // 执行流式查询
    await streamQuery(prompt);

    console.log(`${colors.green}${colors.bright}✓ 测试完成${colors.reset}`);
  } catch (error) {
    console.error(`${colors.red}✗ 错误:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// 运行
main();
