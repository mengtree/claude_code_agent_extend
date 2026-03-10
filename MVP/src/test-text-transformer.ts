/**
 * Text Transformer Skill Test
 * 测试文本转换器功能
 */

import { TextTransformer, TransformRequest } from './skills/text-transformer';

// ANSI color codes for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    log(`❌ ${message}`, 'red');
    throw new Error(message);
  }
}

function testBasicTransformations(): void {
  log('\n=== 测试基本转换 ===', 'blue');

  const transformer = new TextTransformer();
  const tests: TransformRequest[] = [
    { transform: 'uppercase', text: 'hello world' },
    { transform: 'lowercase', text: 'HELLO WORLD' },
    { transform: 'capitalize', text: 'hello world' },
    { transform: 'reverse', text: 'hello' },
    { transform: 'strip_spaces', text: 'h e l l o' },
    { transform: 'count_chars', text: 'hello world' },
    { transform: 'count_words', text: 'hello world test' },
    { transform: 'remove_duplicates', text: 'hello' }
  ];

  tests.forEach(test => {
    const result = transformer.transform(test);
    if (result.error) {
      log(`❌ ${test.transform}("${test.text}") => Error: ${result.error}`, 'red');
    } else {
      const displayResult = typeof result.result === 'string'
        ? `"${result.result}"`
        : result.result;
      log(`✅ ${test.transform.padEnd(20)} "${test.text}" => ${displayResult}`, 'green');
    }
  });
}

function testEdgeCases(): void {
  log('\n=== 测试边界情况 ===', 'blue');

  const transformer = new TextTransformer();

  // 测试空字符串
  log('测试空字符串:', 'yellow');
  const emptyString = transformer.transform({ transform: 'uppercase', text: '' });
  log(`  empty string uppercase => "${emptyString.result}"`, 'green');
  assert(emptyString.result === '', 'Empty string should remain empty');

  // 测试只有空格的字符串
  log('\n测试只有空格的字符串:', 'yellow');
  const spacesOnly = transformer.transform({ transform: 'strip_spaces', text: '     ' });
  log(`  spaces only strip => "${spacesOnly.result}" (length: ${spacesOnly.result?.toString().length})`, 'green');
  assert(spacesOnly.result === '', 'Spaces only should become empty');

  // 测试单个字符
  log('\n测试单个字符:', 'yellow');
  const singleChar = transformer.transform({ transform: 'reverse', text: 'a' });
  log(`  single char reverse => "${singleChar.result}"`, 'green');
  assert(singleChar.result === 'a', 'Single char should remain same');

  // 测试中文字符
  log('\n测试中文字符:', 'yellow');
  const chineseText = transformer.transform({ transform: 'uppercase', text: '你好世界' });
  log(`  chinese text uppercase => "${chineseText.result}"`, 'green');

  // 测试混合字符
  log('\n测试混合字符:', 'yellow');
  const mixedText = transformer.transform({ transform: 'reverse', text: 'a你b好c' });
  log(`  mixed text reverse => "${mixedText.result}"`, 'green');

  // 测试单词统计边界情况
  log('\n测试单词统计边界情况:', 'yellow');
  const emptyWords = transformer.transform({ transform: 'count_words', text: '' });
  log(`  empty text words => ${emptyWords.result}`, 'green');
  assert(emptyWords.result === 0, 'Empty text should have 0 words');

  const multipleSpaces = transformer.transform({ transform: 'count_words', text: 'hello    world' });
  log(`  multiple spaces words => ${multipleSpaces.result}`, 'green');
  assert(multipleSpaces.result === 2, 'Multiple spaces should still count as 2 words');
}

function testBatchTransformations(): void {
  log('\n=== 测试批量转换 ===', 'blue');

  const transformer = new TextTransformer();
  const batchRequests: TransformRequest[] = [
    { transform: 'uppercase', text: 'hello' },
    { transform: 'lowercase', text: 'WORLD' },
    { transform: 'reverse', text: 'test' },
    { transform: 'capitalize', text: 'example' }
  ];

  const results = transformer.transformBatch(batchRequests);
  log(`批量处理 ${results.length} 个转换请求:`, 'yellow');

  results.forEach((result, index) => {
    if (result.error) {
      log(`  [${index + 1}] ❌ Error: ${result.error}`, 'red');
    } else {
      const displayResult = typeof result.result === 'string'
        ? `"${result.result}"`
        : result.result;
      log(`  [${index + 1}] ✅ ${result.transform.padEnd(12)} => ${displayResult}`, 'green');
    }
  });

  assert(results.length === 4, 'Should have 4 results');
  assert(results.every(r => !r.error), 'All results should be successful');
}

function testMetadata(): void {
  log('\n=== 测试元数据 ===', 'blue');

  const transformer = new TextTransformer();

  const result = transformer.transform({ transform: 'uppercase', text: 'hello world test' });

  log('转换结果元数据:', 'yellow');
  log(`  原文: "${result.original}"`, 'cyan');
  log(`  结果: "${result.result}"`, 'cyan');
  log(`  转换类型: ${result.transform}`, 'cyan');
  log(`  元数据:`, 'cyan');
  log(`    - 长度: ${result.metadata?.length}`, 'cyan');
  log(`    - 单词数: ${result.metadata?.wordCount}`, 'cyan');
  log(`    - 字符数: ${result.metadata?.charCount}`, 'cyan');

  const expectedLength = 'hello world test'.length;
  assert(result.metadata?.length === expectedLength, `Length should be ${expectedLength}`);
  assert(result.metadata?.wordCount === 3, 'Word count should be 3');
  assert(result.metadata?.charCount === expectedLength, `Char count should be ${expectedLength}`);
}

function testSupportedTransforms(): void {
  log('\n=== 支持的转换类型 ===', 'blue');

  const transformer = new TextTransformer();
  const transforms = transformer.getSupportedTransforms();

  log(`共支持 ${transforms.length} 种转换类型:`, 'yellow');

  transforms.forEach(transform => {
    const description = transformer.getTransformDescription(transform);
    log(`  • ${transform.padEnd(20)} - ${description}`, 'cyan');
  });

  assert(transforms.length === 8, 'Should support 8 transform types');
}

function testIntentMatching(): void {
  log('\n=== 测试意图匹配 ===', 'blue');

  const testCases = [
    { message: '请把这段文字转大写', expected: true },
    { message: '帮我统计字符数', expected: true },
    { message: '把文本转小写', expected: true },
    { message: '反转这段文字', expected: true },
    { message: '今天天气怎么样', expected: false },
    { message: '帮我写个代码', expected: false },
    { message: 'uppercase this text', expected: true },
    { message: 'count the words', expected: true }
  ];

  testCases.forEach(({ message, expected }) => {
    const result = TextTransformer.isMatch(message);
    const status = result === expected ? '✅' : '❌';
    const color = result === expected ? 'green' : 'red';
    log(`  ${status} "${message}" => ${result} (expected: ${expected})`, color);
    assert(result === expected, `Intent matching failed for: ${message}`);
  });
}

function testErrorHandling(): void {
  log('\n=== 测试错误处理 ===', 'blue');

  const transformer = new TextTransformer();

  // 测试无效的转换类型
  log('测试无效转换类型:', 'yellow');
  const invalidTransform = transformer.transform({
    transform: 'invalid' as any,
    text: 'hello'
  });

  if (invalidTransform.error) {
    log(`  ✅ 正确处理了无效转换类型: ${invalidTransform.error}`, 'green');
  } else {
    log(`  ❌ 未能捕获无效转换类型`, 'red');
  }

  assert(invalidTransform.error !== undefined, 'Should return error for invalid transform');
}

// 运行所有测试
log('\n📝 文本转换器 Skill 测试', 'blue');
log('='.repeat(50), 'blue');

try {
  testBasicTransformations();
  testEdgeCases();
  testBatchTransformations();
  testMetadata();
  testSupportedTransforms();
  testIntentMatching();
  testErrorHandling();

  log('\n✨ 所有测试通过！', 'green');
} catch (error) {
  log('\n❌ 测试失败！', 'red');
  if (error instanceof Error) {
    log(error.message, 'red');
  }
  process.exit(1);
}
