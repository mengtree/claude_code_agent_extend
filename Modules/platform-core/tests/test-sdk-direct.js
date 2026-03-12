/**
 * 直接测试 SDK 调用 - 类似 MVP 的方式
 */

const dynamicImport = new Function(
  'specifier',
  'return import(specifier);'
);

async function main() {
  console.log('直接测试 SDK 调用...\n');

  try {
    // 动态导入 SDK
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');

    console.log('SDK 已加载');

    // 创建查询
    const query = sdk.query({
      prompt: '你好，请用一句话介绍你自己',
      options: {
        cwd: process.cwd(),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: true,
        abortController: new AbortController()
      }
    });

    console.log('查询已创建，开始接收消息...\n');

    // 处理消息
    for await (const message of query) {
      console.log('收到消息:', message.type);

      if (message.type === 'result') {
        console.log('\n结果:', message.result || JSON.stringify(message.structured_output));
        console.log('会话 ID:', message.session_id);
        console.log('耗时:', message.duration_ms, 'ms');
        console.log('成本:', message.total_cost_usd, 'USD');
        break;
      }
    }

    console.log('\n✅ 测试完成');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error('堆栈:', error.stack);
    process.exit(1);
  }
}

main();
