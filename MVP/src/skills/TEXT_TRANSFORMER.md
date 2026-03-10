# 文本转换器 Skill (Text Transformer Skill)

一个功能完整的文本转换 skill，支持多种文本处理操作。

## 功能特性

- ✅ **转大写** (uppercase): hello -> HELLO
- ✅ **转小写** (lowercase): HELLO -> hello
- ✅ **首字母大写** (capitalize): hello -> Hello
- ✅ **反转文本** (reverse): hello -> olleh
- ✅ **去除所有空格** (strip_spaces): h e l l o -> hello
- ✅ **统计字符数** (count_chars): 返回文本字符总数
- ✅ **统计单词数** (count_words): 返回文本单词总数
- ✅ **去除重复字符** (remove_duplicates): hello -> helo

## API 端点

### 1. 单次转换

**请求**
```http
POST /text-transformer/transform
Content-Type: application/json

{
  "transform": "uppercase",
  "text": "hello world"
}
```

**响应**
```json
{
  "result": "HELLO WORLD",
  "transform": "uppercase",
  "original": "hello world",
  "metadata": {
    "length": 11,
    "wordCount": 2,
    "charCount": 11
  }
}
```

### 2. 批量转换

**请求**
```http
POST /text-transformer/batch
Content-Type: application/json

{
  "requests": [
    { "transform": "uppercase", "text": "hello" },
    { "transform": "reverse", "text": "world" }
  ]
}
```

**响应**
```json
{
  "results": [
    {
      "result": "HELLO",
      "transform": "uppercase",
      "original": "hello",
      "metadata": { "length": 5, "wordCount": 1, "charCount": 5 }
    },
    {
      "result": "dlrow",
      "transform": "reverse",
      "original": "world",
      "metadata": { "length": 5, "wordCount": 1, "charCount": 5 }
    }
  ]
}
```

### 3. 获取支持的转换类型

**请求**
```http
GET /text-transformer/transforms
```

**响应**
```json
{
  "transforms": [
    { "transform": "uppercase", "description": "转大写 (hello -> HELLO)" },
    { "transform": "lowercase", "description": "转小写 (HELLO -> hello)" },
    { "transform": "capitalize", "description": "首字母大写 (hello -> Hello)" },
    { "transform": "reverse", "description": "反转文本 (hello -> olleh)" },
    { "transform": "strip_spaces", "description": "去除所有空格 (h e l l o -> hello)" },
    { "transform": "count_chars", "description": "统计字符数" },
    { "transform": "count_words", "description": "统计单词数" },
    { "transform": "remove_duplicates", "description": "去除重复字符 (hello -> helo)" }
  ]
}
```

## 支持的转换类型

| 转换 | transform | 描述 | 示例 |
|------|-----------|------|------|
| 转大写 | `uppercase` | 转换为大写 | hello -> HELLO |
| 转小写 | `lowercase` | 转换为小写 | HELLO -> hello |
| 首字母大写 | `capitalize` | 首字母大写其余小写 | hello -> Hello |
| 反转文本 | `reverse` | 反转字符串 | hello -> olleh |
| 去除空格 | `strip_spaces` | 去除所有空格 | h e l l o -> hello |
| 统计字符 | `count_chars` | 返回字符总数 | hello -> 5 |
| 统计单词 | `count_words` | 返回单词总数 | hello world -> 2 |
| 去除重复 | `remove_duplicates` | 去除重复字符 | hello -> helo |

## 使用示例

### cURL 示例

```bash
# 转大写
curl -X POST http://localhost:3000/text-transformer/transform \
  -H "Content-Type: application/json" \
  -d '{"transform":"uppercase","text":"hello world"}'

# 反转文本
curl -X POST http://localhost:3000/text-transformer/transform \
  -H "Content-Type: application/json" \
  -d '{"transform":"reverse","text":"hello"}'

# 统计字符数
curl -X POST http://localhost:3000/text-transformer/transform \
  -H "Content-Type: application/json" \
  -d '{"transform":"count_chars","text":"hello world"}'
```

### JavaScript/TypeScript 示例

```typescript
// 直接使用 TextTransformer 类
import { TextTransformer } from './skills/text-transformer';

const transformer = new TextTransformer();

// 转大写
const upperResult = transformer.transform({
  transform: 'uppercase',
  text: 'hello world'
});
console.log(upperResult); // { result: 'HELLO WORLD', ... }

// 反转文本
const reverseResult = transformer.transform({
  transform: 'reverse',
  text: 'hello'
});
console.log(reverseResult); // { result: 'olleh', ... }

// 统计字符数
const countResult = transformer.transform({
  transform: 'count_chars',
  text: 'hello world'
});
console.log(countResult); // { result: 11, ... }

// 批量转换
const batchResults = transformer.transformBatch([
  { transform: 'uppercase', text: 'hello' },
  { transform: 'lowercase', text: 'WORLD' }
]);
```

## 运行测试

```bash
# 构建项目
npm run build

# 运行文本转换器测试
npx ts-node src/test-text-transformer.ts
```

## 特性

- ✅ 支持多种文本转换操作
- ✅ 批量转换支持
- ✅ 完善的元数据返回（长度、单词数等）
- ✅ TypeScript 类型安全
- ✅ 单元测试覆盖
- ✅ 意图匹配支持（通过 isMatch 方法）

## 意图识别

Text Transformer 提供静态方法 `isMatch()` 用于快速判断用户输入是否匹配文本转换意图：

```typescript
import { TextTransformer } from './skills/text-transformer';

// 检查消息是否匹配文本转换意图
TextTransformer.isMatch('请把这段文字转大写'); // true
TextTransformer.isMatch('帮我统计字符数'); // true
TextTransformer.isMatch('今天天气怎么样'); // false
```
