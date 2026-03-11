/**
 * 平台核心运行时测试脚本
 *
 * 测试 Module Registry、Message Bus、Module Supervisor 的协同工作
 */

import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { createPlatformCoreRuntime } from '../dist/runtime/PlatformCoreRuntime.js';
import { randomUUID } from 'node:crypto';

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
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 主测试函数
 */
async function runTests() {
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}  平台核心运行时测试${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}════════════════════════════════════════${colors.reset}\n`);

  // 1. 创建运行时
  console.log(`${colors.cyan}1️⃣ 创建平台核心运行时${colors.reset}`);
  const runtime = createPlatformCoreRuntime({
    modulesRoot: resolve(cwd(), 'Modules'),
    healthCheckInterval: 10000,
    maxRestarts: 3,
    restartBackoffMs: 3000,
    logLevel: 'info'
  });
  console.log(`${colors.green}✓${colors.reset} 运行时创建成功\n`);

  try {
    // 2. 启动运行时
    console.log(`${colors.cyan}2️⃣ 启动运行时${colors.reset}`);
    await runtime.start();
    console.log(`${colors.green}✓${colors.reset} 运行时启动成功\n`);

    // 显示运行时状态
    const status = runtime.getStatus();
    console.log(`${colors.yellow}📊 运行时状态:${colors.reset}`);
    console.log(`  模块总数: ${status.modules.total}`);
    console.log(`  运行中: ${status.processes.runningModules}`);
    console.log(`  消息处理器: ${status.messaging.totalHandlers}`);
    console.log();

    // 3. 测试模块注册表
    console.log(`${colors.cyan}3️⃣ 测试模块注册表${colors.reset}`);
    const registry = runtime.getRegistry();
    const allModules = registry.getAllModules();

    console.log(`${colors.yellow}已注册的模块:${colors.reset}`);
    for (const module of allModules) {
      const statusColor = module.status === 'running' ? colors.green : colors.dim;
      console.log(`  ${statusColor}●${colors.reset} ${module.moduleId} (${module.manifest.kind}) v${module.manifest.version}`);

      // 显示模块能力
      const capabilities = registry.getModuleCapabilities(module.moduleId);
      if (capabilities.length > 0) {
        console.log(`    ${colors.dim}能力: ${capabilities.map(c => c.action).join(', ')}${colors.reset}`);
      }
    }
    console.log();

    // 4. 测试消息总线
    console.log(`${colors.cyan}4️⃣ 测试消息总线${colors.reset}`);
    const messageBus = runtime.getMessageBus();

    // 订阅消息
    const unsubscribe = messageBus.subscribe('platform-core', (envelope) => {
      console.log(`  ${colors.blue}[接收消息]${colors.reset} ${envelope.fromModule} -> ${envelope.toModule}: ${envelope.action}`);
    });

    // 发送测试消息
    const testMessageId = runtime.send({
      traceId: randomUUID(),
      fromModule: 'test',
      toModule: 'platform-core',
      action: 'test_action',
      payload: { test: 'hello' },
      replyTo: 'test',
      context: {
        sessionId: 'test-session-001'
      },
      timeoutMs: 5000
    });

    console.log(`  ${colors.green}✓${colors.reset} 发送测试消息 (ID: ${testMessageId.slice(0, 8)}...)`);

    // 等待一秒
    await delay(500);
    unsubscribe();
    console.log();

    // 5. 测试模块守护进程
    console.log(`${colors.cyan}5️⃣ 测试模块守护进程${colors.reset}`);
    const supervisor = runtime.getSupervisor();

    const runningModules = supervisor.getRunningModules();
    console.log(`  运行中的模块: ${runningModules.length > 0 ? runningModules.join(', ') : '无'}`);

    const allProcesses = supervisor.getAllProcesses();
    console.log(`  进程信息:`);
    for (const proc of allProcesses) {
      console.log(`    ${colors.cyan}${proc.moduleId}${colors.reset} - PID: ${proc.process.pid || 'N/A'} - 重启次数: ${proc.restartCount}`);
    }
    console.log();

    // 6. 测试查询能力
    console.log(`${colors.cyan}6️⃣ 测试消息请求${colors.reset}`);

    try {
      const response = await runtime.request({
        traceId: randomUUID(),
        fromModule: 'test',
        toModule: 'platform-core',
        action: 'ping',
        payload: {},
        replyTo: 'test',
        context: {},
        timeoutMs: 2000
      });

      console.log(`  ${colors.green}✓${colors.reset} 收到响应`);
    } catch (error) {
      console.log(`  ${colors.yellow}⚠${colors.reset} 请求超时（预期行为，因为模块未实现消息处理）`);
    }
    console.log();

    // 7. 显示最终统计
    console.log(`${colors.cyan}7️⃣ 最终统计${colors.reset}`);
    const finalStats = runtime.getStatus();
    console.log(`  模块统计:`);
    console.log(`    总数: ${finalStats.modules.total}`);
    console.log(`    按状态: ${JSON.stringify(finalStats.modules.byStatus)}`);
    console.log(`    按类型: ${JSON.stringify(finalStats.modules.byKind)}`);
    console.log(`  消息统计:`);
    console.log(`    处理器: ${finalStats.messaging.totalHandlers}`);
    console.log(`    订阅模块: ${finalStats.messaging.subscribedModules}`);
    console.log(`    历史消息: ${finalStats.messaging.historySize}`);
    console.log(`  进程统计:`);
    console.log(`    运行中: ${finalStats.processes.runningModules}`);
    console.log(`    总重启: ${finalStats.processes.totalRestarts}`);
    console.log(`    不健康: ${finalStats.processes.unhealthyModules}`);

  } finally {
    // 8. 停止运行时
    console.log(`\n${colors.cyan}8️⃣ 停止运行时${colors.reset}`);
    await runtime.stop();
    console.log(`${colors.green}✓${colors.reset} 运行时已停止`);
  }

  console.log(`\n${colors.green}${colors.bright}✅ 所有测试完成${colors.reset}\n`);
}

// 运行测试
runTests().catch(error => {
  console.error(`${colors.red}✗ 测试失败:${colors.reset}`, error);
  process.exit(1);
});
