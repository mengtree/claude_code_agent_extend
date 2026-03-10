/**
 * Calculator Skill
 * 支持基本数学运算：加、减、乘、除、幂运算、模运算
 */

export type OperationType = 'add' | 'subtract' | 'multiply' | 'divide' | 'power' | 'modulus';

export interface CalculateRequest {
  operation: OperationType;
  a: number;
  b: number;
}

export interface CalculateResponse {
  result: number;
  operation: OperationType;
  expression: string;
  error?: string;
}

/**
 * 计算器类，支持基本数学运算
 */
export class Calculator {
  /**
   * 执行计算操作
   * @param request 计算请求
   * @returns 计算结果
   */
  calculate(request: CalculateRequest): CalculateResponse {
    const { operation, a, b } = request;

    try {
      const result = this.performOperation(operation, a, b);
      const expression = this.buildExpression(operation, a, b);

      return {
        result,
        operation,
        expression
      };
    } catch (error) {
      return {
        result: 0,
        operation,
        expression: this.buildExpression(operation, a, b),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 执行具体的数学运算
   */
  private performOperation(operation: OperationType, a: number, b: number): number {
    switch (operation) {
      case 'add':
        return a + b;

      case 'subtract':
        return a - b;

      case 'multiply':
        return a * b;

      case 'divide':
        if (b === 0) {
          throw new Error('Division by zero is not allowed');
        }
        return a / b;

      case 'power':
        return Math.pow(a, b);

      case 'modulus':
        if (b === 0) {
          throw new Error('Modulus by zero is not allowed');
        }
        return a % b;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 构建表达式字符串
   */
  private buildExpression(operation: OperationType, a: number, b: number): string {
    const operatorMap: Record<OperationType, string> = {
      add: '+',
      subtract: '-',
      multiply: '×',
      divide: '÷',
      power: '^',
      modulus: '%'
    };

    const operator = operatorMap[operation];
    return `${a} ${operator} ${b}`;
  }

  /**
   * 批量计算
   * @param requests 计算请求列表
   * @returns 计算结果列表
   */
  calculateBatch(requests: CalculateRequest[]): CalculateResponse[] {
    return requests.map(request => this.calculate(request));
  }

  /**
   * 获取支持的运算列表
   */
  getSupportedOperations(): OperationType[] {
    return ['add', 'subtract', 'multiply', 'divide', 'power', 'modulus'];
  }

  /**
   * 获取运算描述
   */
  getOperationDescription(operation: OperationType): string {
    const descriptions: Record<OperationType, string> = {
      add: '加法 (a + b)',
      subtract: '减法 (a - b)',
      multiply: '乘法 (a × b)',
      divide: '除法 (a ÷ b)',
      power: '幂运算 (a ^ b)',
      modulus: '模运算 (a % b)'
    };

    return descriptions[operation] || '未知运算';
  }
}

/**
 * 创建计算器实例的工厂函数
 */
export function createCalculator(): Calculator {
  return new Calculator();
}
