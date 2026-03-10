/**
 * Calculator Skill Test
 * 测试计算器功能
 */

import { Calculator, CalculateRequest } from './skills/calculator';

// ANSI color codes for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function testBasicOperations(): void {
  log('\n=== 测试基本运算 ===', 'blue');

  const calculator = new Calculator();
  const tests: CalculateRequest[] = [
    { operation: 'add', a: 10, b: 5 },
    { operation: 'subtract', a: 10, b: 5 },
    { operation: 'multiply', a: 10, b: 5 },
    { operation: 'divide', a: 10, b: 5 },
    { operation: 'power', a: 2, b: 8 },
    { operation: 'modulus', a: 17, b: 5 }
  ];

  tests.forEach(test => {
    const result = calculator.calculate(test);
    if (result.error) {
      log(`❌ ${result.expression} => Error: ${result.error}`, 'red');
    } else {
      log(`✅ ${result.expression} = ${result.result}`, 'green');
    }
  });
}

function testEdgeCases(): void {
  log('\n=== 测试边界情况 ===', 'blue');

  const calculator = new Calculator();

  // 测试除以零
  log('测试除以零:', 'yellow');
  const divideByZero = calculator.calculate({ operation: 'divide', a: 10, b: 0 });
  log(`  10 ÷ 0 => ${divideByZero.error || divideByZero.result}`, divideByZero.error ? 'green' : 'red');

  // 测试模运算除以零
  log('测试模运算除以零:', 'yellow');
  const modulusByZero = calculator.calculate({ operation: 'modulus', a: 10, b: 0 });
  log(`  10 % 0 => ${modulusByZero.error || modulusByZero.result}`, modulusByZero.error ? 'green' : 'red');

  // 测试负数运算
  log('\n测试负数运算:', 'yellow');
  const negativeAdd = calculator.calculate({ operation: 'add', a: -5, b: 3 });
  log(`  -5 + 3 = ${negativeAdd.result}`, 'green');

  const negativeMultiply = calculator.calculate({ operation: 'multiply', a: -4, b: -3 });
  log(`  -4 × -3 = ${negativeMultiply.result}`, 'green');

  // 测试小数运算
  log('\n测试小数运算:', 'yellow');
  const decimalDivide = calculator.calculate({ operation: 'divide', a: 7, b: 2 });
  log(`  7 ÷ 2 = ${decimalDivide.result}`, 'green');

  const decimalPower = calculator.calculate({ operation: 'power', a: 2.5, b: 2 });
  log(`  2.5 ^ 2 = ${decimalPower.result}`, 'green');
}

function testBatchOperations(): void {
  log('\n=== 测试批量运算 ===', 'blue');

  const calculator = new Calculator();
  const batchRequests: CalculateRequest[] = [
    { operation: 'add', a: 1, b: 2 },
    { operation: 'multiply', a: 3, b: 4 },
    { operation: 'subtract', a: 10, b: 3 }
  ];

  const results = calculator.calculateBatch(batchRequests);
  results.forEach(result => {
    log(`  ${result.expression} = ${result.result}`, 'green');
  });
}

function testOperationsInfo(): void {
  log('\n=== 支持的运算 ===', 'blue');

  const calculator = new Calculator();
  const operations = calculator.getSupportedOperations();

  operations.forEach(op => {
    const description = calculator.getOperationDescription(op);
    log(`  • ${op.padEnd(10)} - ${description}`, 'yellow');
  });
}

// 运行所有测试
log('\n🧮 计算器 Skill 测试', 'blue');
log('='.repeat(40), 'blue');

testBasicOperations();
testEdgeCases();
testBatchOperations();
testOperationsInfo();

log('\n✨ 测试完成！', 'green');
