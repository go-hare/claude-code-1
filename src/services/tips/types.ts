import type { ThemeName } from '@anthropic/ink'
import type { FileStateCache } from '../../utils/fileStateCache.js'

/** densable `e.session` — WeakMap owner for `Xt` / `Ce` / `Ghe`. */
export type TipSession = {
  host: object
}

/** Spinner 提示评估时可用的会话上下文（字段可按调用场景部分提供）。 */
export type TipContext = {
  theme?: ThemeName // 当前终端主题名，用于 `color()` 等着色
  readFileState?: FileStateCache // 近期已读文件 LRU，用于文件类相关性判断
  bashTools?: Set<string> // 本会话出现过的 bash 子命令集合
  /** Official: bare hostnames from https?:// URLs in bash commands this session. */
  bashHosts?: Set<string>
  /** densable `e.session` — `h.of(e.session.host)` / `Gt(e.session.host)`. */
  session: TipSession
  /** densable `e.storageV5` — `Xt.getMarketplacePluginTips(e.storageV5)`. */
  storageV5?: unknown
}

/** 内置或用户自定义的 Spinner 提示条目。 */
export type Tip = {
  id: string // 稳定 id：用于冷却与历史去重
  content: (ctx?: TipContext) => Promise<string> // 异步生成 Spinner 旁提示文案
  cooldownSessions: number // 至少间隔多少会话后才可再次展示
  /**
   * densable 2.1.217 `maxLifetimeShows`：跨会话终身展示上限。
   * 缺省 = 无上限；仅 `recordTipShown` 成功写入 tipsHistory 时计入。
   */
  maxLifetimeShows?: number
  // 必填：densable `Do`/`$he` 直接调用，不做存在性守卫（见 orgTips.247 回归）。
  // 内置 / org / marketplace 三个来源都无条件设置它。
  isRelevant: (ctx?: TipContext) => Promise<boolean>
  /** densable 2.1.247 `nt` — trusted `label` (default `"Tip"`, cap 40). */
  label?: string
  /** densable 2.1.247 `nt` — object tip `priority`, clamped −10..10. */
  priority?: number
  /**
   * densable 2.1.247 `Pi` — survives the non-firstParty provider filter.
   * Org/custom override and marketplace tips always set it; built-ins set it
   * per upstream (see gold-tips-providerAgnostic-0.txt). Anthropic
   * account/subscription tips deliberately leave it unset.
   */
  providerAgnostic?: boolean
  /** densable 2.1.247 `Pi` / marketplace `advertisedCommand:"plugin"`. */
  advertisedCommand?: string
  /**
   * densable 2.1.247 `Xt.buildMarketplacePluginTips` — always `name@marketplace`.
   * Only Qhe reads this field.
   */
  pluginId?: string
}
