/**
 * Skill 模板
 *
 * 所有skill应该遵循这个基本结构
 */

// ============ 1. 类型定义 ============
export interface YourSkillRequest {
  // 定义skill的输入参数
  input: string;
  options?: {
    // 可选参数
  };
}

export interface YourSkillResponse {
  // 定义skill的输出
  result: unknown;
  error?: string;
}

// ============ 2. Skill类 ============
export class YourSkill {
  /**
   * 执行skill的主要方法
   */
  execute(request: YourSkillRequest): YourSkillResponse {
    try {
      // 实现skill逻辑
      const result = this.processRequest(request);

      return { result };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 处理请求的内部方法
   */
  private processRequest(request: YourSkillRequest): unknown {
    // 实现具体的处理逻辑
    return null;
  }

  /**
   * 验证输入是否匹配这个skill
   * （可选，用于意图识别前的快速过滤）
   */
  static isMatch(message: string): boolean {
    // 返回true如果这个skill应该处理这个消息
    return false;
  }
}
