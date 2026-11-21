import { getInitialSettings } from './settings/settings.js'

// Usage 类型（从 API 响应中提取）
interface Usage {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

const DEFAULT_CACHE_THRESHOLD = 70

/**
 * 从 settings.json 读取上下文分析的缓存阈值配置
 */
export function getCacheThreshold(): number {
  const settings = getInitialSettings()
  return settings.cacheThreshold ?? DEFAULT_CACHE_THRESHOLD
}

/**
 * 计算缓存命中率
 * 返回值范围 0-100，null 表示无有效数据
 */
export function calculateCacheHitRate(
  usage: Usage | null | undefined,
): number | null {
  if (!usage) return null

  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } =
    usage

  // 所有缓存字段为 0 表示无缓存数据
  if (cache_read_input_tokens === 0 && cache_creation_input_tokens === 0) {
    return null
  }

  const totalInputTokens =
    input_tokens + cache_creation_input_tokens + cache_read_input_tokens
  if (totalInputTokens === 0) return null

  return (cache_read_input_tokens / totalInputTokens) * 100
}
