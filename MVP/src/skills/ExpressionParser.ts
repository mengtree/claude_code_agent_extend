/**
 * 表达式解析器
 * 支持解析和计算数学表达式
 */

export class ExpressionParser {
  /**
   * 解析并计算数学表达式
   * 支持运算符: +, -, *, /, %, ^(幂)
   * 支持括号和优先级
   */
  parseAndCalculate(expression: string): { result: number; error?: string } {
    try {
      const sanitized = this.sanitizeExpression(expression);
      const result = this.evaluate(sanitized);
      return { result };
    } catch (error) {
      return {
        result: 0,
        error: error instanceof Error ? error.message : '计算错误'
      };
    }
  }

  /**
   * 清理表达式字符串
   */
  private sanitizeExpression(expression: string): string {
    // 移除所有空格
    let sanitized = expression.replace(/\s+/g, '');
    // 替换中文符号
    sanitized = sanitized.replace(/×/g, '*').replace(/÷/g, '/');
    // 移除非数学字符（除了数字、运算符、括号、小数点）
    sanitized = sanitized.replace(/[^\d+\-*/%^().]/g, '');
    return sanitized;
  }

  /**
   * 使用递归下降法计算表达式
   */
  private evaluate(expression: string): number {
    // 解析 tokens
    const tokens = this.tokenize(expression);
    let pos = 0;

    const parseExpression = (): number => {
      let left = parseTerm();

      while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
        const op = tokens[pos++];
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }

      return left;
    };

    const parseTerm = (): number => {
      let left = parseFactor();

      while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/' || tokens[pos] === '%')) {
        const op = tokens[pos++];
        const right = parseFactor();
        if (op === '*') {
          left = left * right;
        } else if (op === '/') {
          if (right === 0) {
            throw new Error('除数不能为零');
          }
          left = left / right;
        } else {
          if (right === 0) {
            throw new Error('模数不能为零');
          }
          left = left % right;
        }
      }

      return left;
    };

    const parseFactor = (): number => {
      let left = parsePrimary();

      while (pos < tokens.length && tokens[pos] === '^') {
        pos++; // 跳过 ^
        const right = parsePrimary();
        left = Math.pow(left, right);
      }

      return left;
    };

    const parsePrimary = (): number => {
      if (pos >= tokens.length) {
        throw new Error('表达式不完整');
      }

      const token = tokens[pos++];

      // 处理负号
      if (token === '-') {
        return -parsePrimary();
      }

      // 处理括号
      if (token === '(') {
        const value = parseExpression();
        if (pos >= tokens.length || tokens[pos] !== ')') {
          throw new Error('缺少右括号');
        }
        pos++; // 跳过 )
        return value;
      }

      // 处理数字
      if (/^-?\d+\.?\d*$/.test(token)) {
        return parseFloat(token);
      }

      throw new Error(`无法解析: ${token}`);
    };

    return parseExpression();
  }

  /**
   * 将表达式转换为 tokens
   */
  private tokenize(expression: string): string[] {
    const tokens: string[] = [];
    let i = 0;

    while (i < expression.length) {
      const char = expression[i];

      if (/\s/.test(char)) {
        i++;
        continue;
      }

      if (/\d/.test(char) || char === '.') {
        let num = '';
        while (i < expression.length && (/\d/.test(expression[i]) || expression[i] === '.')) {
          num += expression[i++];
        }
        tokens.push(num);
        continue;
      }

      if (['+', '-', '*', '/', '%', '^', '(', ')'].includes(char)) {
        tokens.push(char);
        i++;
        continue;
      }

      i++;
    }

    return tokens;
  }

  /**
   * 检测字符串是否包含数学表达式
   */
  isMathExpression(text: string): boolean {
    const mathPattern = /[\d+\-*/%^()]/;
    // 至少包含一个数字和一个运算符
    return /\d/.test(text) && mathPattern.test(text) && !this.isTalkingAboutCalculation(text);
  }

  /**
   * 判断是否是在谈论计算而不是要求计算
   * 比如"帮我实现一个计算器"是要求实现，不是要求计算
   */
  private isTalkingAboutCalculation(text: string): boolean {
    const talkKeywords = [
      '实现', '开发', '创建', '编写', '设计', '构建',
      '计算器', '函数', '方法', '类', '模块', '功能'
    ];
    return talkKeywords.some(keyword => text.includes(keyword));
  }
}
