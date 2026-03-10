# 自定义 Skill 开发指南

本指南说明如何在 AgentExtend-MVP 项目中创建和集成自定义 skill。

## 快速开始

已创建的示例 skill：**文本转换器 (Text Transformer)**

## Skill 开发流程

### 1. 创建 Skill 实现

在 `src/skills/` 目录下创建你的 skill 文件，参考模板 `YOUR_SKILL_TEMPLATE.ts`：

**文件结构：**
```typescript
// ============ 类型定义 ============
export interface YourSkillRequest {
  // 输入参数
}

export interface YourSkillResponse {
  // 输出结果
  result: unknown;
  error?: string;
}

// ============ Skill 类 ============
export class YourSkill {
  // 主执行方法
  execute(request: YourSkillRequest): YourSkillResponse {
    // 实现逻辑
  }

  // 意图匹配（静态方法，可选）
  static isMatch(message: string): boolean {
    // 返回 true 如果这个 skill 应该处理该消息
  }
}
```

**示例：text-transformer.ts**
- 支持多种转换类型（大写、小写、反转等）
- 提供批量处理功能
- 包含元数据返回

### 2. 创建测试脚本

在 `src/` 目录下创建测试文件 `test-your-skill.ts`：

```typescript
import { YourSkill } from './skills/your-skill';

// 基本功能测试
function testBasicFunctionality() {
  const skill = new YourSkill();
  // 测试基本功能
}

// 边界情况测试
function testEdgeCases() {
  // 测试空值、极端情况等
}

// 运行所有测试
testBasicFunctionality();
testEdgeCases();
console.log('✨ 所有测试通过！');
```

运行测试：
```bash
npx ts-node src/test-your-skill.ts
```

### 3. 更新类型定义

在 `src/types.ts` 中添加新意图：

```typescript
export interface IntentParseResult {
  intent: 'enqueue_task' | 'list_tasks' | 'remove_task' | 'interrupt' | 'clear_session' | 'calculate' | 'your_new_intent';
  acknowledgement: string;
  // 添加你的 skill 特定字段
  yourSkillField?: string;
  priority: TaskPriority;
}
```

### 4. 更新意图解析器

在 `src/IntentParser.ts` 中：

**a) 导入你的 skill：**
```typescript
import { YourSkill } from './skills/your-skill';
```

**b) 更新 INTENT_SCHEMA：**
```typescript
const INTENT_SCHEMA = {
  // ...
  properties: {
    intent: {
      enum: ['...', 'your_new_intent']
    },
    // 添加你的字段
    yourSkillField: { type: 'string' }
  }
};
```

**c) 在 buildPrompt 中添加规则说明：**
```typescript
return [
  // ...
  '8. 如果用户要求 [你的功能描述]，返回 your_new_intent，并提供 yourSkillField 字段。',
  // ...
].join('\n');
```

**d) 在 fallbackParse 中添加快速匹配：**
```typescript
// 检查是否是你的 skill 请求
if (YourSkill.isMatch(trimmedMessage)) {
  const request = this.extractYourSkillRequest(trimmedMessage);
  if (request) {
    return {
      intent: 'your_new_intent',
      acknowledgement: this.buildYourSkillAcknowledgement(request.field),
      // ...
    };
  }
}
```

**e) 添加辅助方法：**
```typescript
private extractYourSkillRequest(message: string): { field: string } | null {
  // 提取逻辑
}

private buildYourSkillAcknowledgement(field: string): string {
  // 构建确认消息
}
```

### 5. 创建文档

创建 `src/skills/YOUR_SKILL.md` 文档，包含：
- 功能特性列表
- API 端点说明
- 请求/响应示例
- 使用示例（cURL, TypeScript）
- 错误处理说明

### 6. 构建和验证

```bash
# 构建项目
npm run build

# 运行测试
npx ts-node src/test-your-skill.ts
```

## 文件清单

创建一个新的 skill 需要修改/创建以下文件：

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/skills/your-skill.ts` | 新建 | Skill 实现 |
| `src/test-your-skill.ts` | 新建 | 测试脚本 |
| `src/skills/YOUR_SKILL.md` | 新建 | 文档 |
| `src/types.ts` | 修改 | 添加意图类型 |
| `src/IntentParser.ts` | 修改 | 集成意图解析 |

## Skill 最佳实践

1. **类型安全**：使用 TypeScript 定义清晰的接口
2. **错误处理**：在响应中包含 error 字段
3. **意图匹配**：实现 `isMatch()` 静态方法用于快速过滤
4. **批量处理**：如果适用，提供 `executeBatch()` 方法
5. **元数据**：返回有用的元数据（长度、计数等）
6. **测试覆盖**：测试基本功能、边界情况和错误处理

## 示例：文本转换器 Skill

已创建的文本转换器 skill 展示了完整的开发流程：

- **功能**：8 种文本转换类型
- **测试**：包含 7 个测试场景
- **集成**：已集成到意图解析器
- **文档**：完整的 API 文档

运行示例测试：
```bash
npx ts-node src/test-text-transformer.ts
```

## 下一步

1. 创建你自己的 skill
2. 编写测试确保功能正确
3. 更新意图解析器集成
4. 编写文档方便他人使用

## 相关文件

- `src/skills/YOUR_SKILL_TEMPLATE.ts` - Skill 模板
- `src/skills/text-transformer.ts` - 示例实现
- `src/skills/calculator.ts` - 计算器 skill
- `src/IntentParser.ts` - 意图解析器
