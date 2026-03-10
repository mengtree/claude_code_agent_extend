# 计算器 Skill (Calculator Skill)

一个简单但功能完整的计算器skill，支持基本数学运算。

## 功能特性

- ✅ **加法** (add): a + b
- ✅ **减法** (subtract): a - b
- ✅ **乘法** (multiply): a × b
- ✅ **除法** (divide): a ÷ b
- ✅ **幂运算** (power): a ^ b
- ✅ **模运算** (modulus): a % b

## API 端点

### 1. 单次计算

**请求**
```http
POST /calculator/calculate
Content-Type: application/json

{
  "operation": "add",
  "a": 10,
  "b": 5
}
```

**响应**
```json
{
  "result": 15,
  "operation": "add",
  "expression": "10 + 5"
}
```

### 2. 批量计算

**请求**
```http
POST /calculator/batch
Content-Type: application/json

{
  "requests": [
    { "operation": "add", "a": 1, "b": 2 },
    { "operation": "multiply", "a": 3, "b": 4 }
  ]
}
```

**响应**
```json
{
  "results": [
    {
      "result": 3,
      "operation": "add",
      "expression": "1 + 2"
    },
    {
      "result": 12,
      "operation": "multiply",
      "expression": "3 × 4"
    }
  ]
}
```

### 3. 获取支持的运算

**请求**
```http
GET /calculator/operations
```

**响应**
```json
{
  "operations": [
    {
      "operation": "add",
      "description": "加法 (a + b)"
    },
    {
      "operation": "subtract",
      "description": "减法 (a - b)"
    },
    {
      "operation": "multiply",
      "description": "乘法 (a × b)"
    },
    {
      "operation": "divide",
      "description": "除法 (a ÷ b)"
    },
    {
      "operation": "power",
      "description": "幂运算 (a ^ b)"
    },
    {
      "operation": "modulus",
      "description": "模运算 (a % b)"
    }
  ]
}
```

## 错误处理

### 除以零错误
```json
{
  "result": 0,
  "operation": "divide",
  "expression": "10 ÷ 0",
  "error": "Division by zero is not allowed"
}
```

### 无效运算
```json
{
  "error": "operation must be one of: add, subtract, multiply, divide, power, modulus"
}
```

## 支持的运算类型

| 运算 | operation | 描述 | 示例 |
|------|-----------|------|------|
| 加法 | `add` | a + b | 10 + 5 = 15 |
| 减法 | `subtract` | a - b | 10 - 5 = 5 |
| 乘法 | `multiply` | a × b | 10 × 5 = 50 |
| 除法 | `divide` | a ÷ b | 10 ÷ 5 = 2 |
| 幂运算 | `power` | a ^ b | 2 ^ 8 = 256 |
| 模运算 | `modulus` | a % b | 17 % 5 = 2 |

## 使用示例

### cURL 示例

```bash
# 加法
curl -X POST http://localhost:3000/calculator/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation":"add","a":10,"b":5}'

# 幂运算
curl -X POST http://localhost:3000/calculator/calculate \
  -H "Content-Type: application/json" \
  -d '{"operation":"power","a":2,"b":8}'

# 批量计算
curl -X POST http://localhost:3000/calculator/batch \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"operation":"add","a":1,"b":2},{"operation":"multiply","a":3,"b":4}]}'
```

### JavaScript/TypeScript 示例

```typescript
// 直接使用 Calculator 类
import { Calculator } from './skills/calculator';

const calculator = new Calculator();

// 单次计算
const result = calculator.calculate({
  operation: 'add',
  a: 10,
  b: 5
});
console.log(result); // { result: 15, operation: 'add', expression: '10 + 5' }

// 批量计算
const batchResults = calculator.calculateBatch([
  { operation: 'add', a: 1, b: 2 },
  { operation: 'multiply', a: 3, b: 4 }
]);
```

## 运行测试

```bash
# 构建项目
npm run build

# 运行计算器测试
npx ts-node src/test-calculator.ts
```

## 特性

- ✅ 支持正数、负数和小数运算
- ✅ 完善的错误处理（除以零检测等）
- ✅ 批量计算支持
- ✅ 清晰的表达式显示
- ✅ TypeScript 类型安全
- ✅ 单元测试覆盖
