/**
 * Text Transformer Skill
 * 支持文本转换功能：大小写转换、文本反转、字符统计、去除空格等
 */

export type TransformType =
  | 'uppercase'        // 转大写
  | 'lowercase'        // 转小写
  | 'capitalize'       // 首字母大写
  | 'reverse'          // 反转文本
  | 'strip_spaces'     // 去除所有空格
  | 'count_chars'      // 统计字符数
  | 'count_words'      // 统计单词数
  | 'remove_duplicates'; // 去除重复字符

export interface TransformRequest {
  transform: TransformType;
  text: string;
}

export interface TransformResponse {
  result: string | number;
  transform: TransformType;
  original: string;
  error?: string;
  metadata?: {
    length?: number;
    wordCount?: number;
    charCount?: number;
  };
}

/**
 * 文本转换器类
 */
export class TextTransformer {
  /**
   * 执行文本转换
   * @param request 转换请求
   * @returns 转换结果
   */
  transform(request: TransformRequest): TransformResponse {
    const { transform, text } = request;

    try {
      const result = this.performTransform(transform, text);
      const metadata = this.buildMetadata(transform, text, result);

      return {
        result,
        transform,
        original: text,
        metadata
      };
    } catch (error) {
      return {
        result: '',
        transform,
        original: text,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 执行具体的文本转换
   */
  private performTransform(transform: TransformType, text: string): string | number {
    switch (transform) {
      case 'uppercase':
        return text.toUpperCase();

      case 'lowercase':
        return text.toLowerCase();

      case 'capitalize':
        return this.capitalize(text);

      case 'reverse':
        return text.split('').reverse().join('');

      case 'strip_spaces':
        return text.replace(/\s+/g, '');

      case 'count_chars':
        return text.length;

      case 'count_words':
        return this.countWords(text);

      case 'remove_duplicates':
        return this.removeDuplicates(text);

      default:
        throw new Error(`Unknown transform type: ${transform}`);
    }
  }

  /**
   * 首字母大写
   */
  private capitalize(text: string): string {
    if (text.length === 0) return text;
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  /**
   * 统计单词数
   */
  private countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
  }

  /**
   * 去除重复字符（保持顺序）
   */
  private removeDuplicates(text: string): string {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const char of text) {
      if (!seen.has(char)) {
        seen.add(char);
        result.push(char);
      }
    }

    return result.join('');
  }

  /**
   * 构建元数据
   */
  private buildMetadata(
    transform: TransformType,
    original: string,
    result: string | number
  ): TransformResponse['metadata'] {
    const metadata: TransformResponse['metadata'] = {
      length: original.length,
      wordCount: this.countWords(original),
      charCount: original.length
    };

    // 根据不同的转换类型添加特定信息
    if (typeof result === 'string') {
      metadata.length = result.length;
    }

    return metadata;
  }

  /**
   * 批量转换
   */
  transformBatch(requests: TransformRequest[]): TransformResponse[] {
    return requests.map(request => this.transform(request));
  }

  /**
   * 获取支持的转换类型
   */
  getSupportedTransforms(): TransformType[] {
    return [
      'uppercase',
      'lowercase',
      'capitalize',
      'reverse',
      'strip_spaces',
      'count_chars',
      'count_words',
      'remove_duplicates'
    ];
  }

  /**
   * 获取转换描述
   */
  getTransformDescription(transform: TransformType): string {
    const descriptions: Record<TransformType, string> = {
      uppercase: '转大写 (hello -> HELLO)',
      lowercase: '转小写 (HELLO -> hello)',
      capitalize: '首字母大写 (hello -> Hello)',
      reverse: '反转文本 (hello -> olleh)',
      strip_spaces: '去除所有空格 (h e l l o -> hello)',
      count_chars: '统计字符数',
      count_words: '统计单词数',
      remove_duplicates: '去除重复字符 (hello -> helo)'
    };

    return descriptions[transform] || '未知转换';
  }

  /**
   * 检查消息是否匹配文本转换意图
   */
  static isMatch(message: string): boolean {
    const keywords = [
      '转大写', '转小写', '首字母大写', '反转', '去除空格',
      '统计字符', '统计单词', '字符数', '单词数',
      'uppercase', 'lowercase', 'capitalize', 'reverse',
      'count', '统计', '转换'
    ];

    return keywords.some(keyword => message.toLowerCase().includes(keyword.toLowerCase()));
  }
}

/**
 * 创建文本转换器实例的工厂函数
 */
export function createTextTransformer(): TextTransformer {
  return new TextTransformer();
}
