import type { AppState } from '../../state/AppStateStore.js'

export type RuntimeSessionIdentity = {
  sessionId: string
  parentSessionId?: string
  sessionProjectDir: string | null
  originalCwd: string
  projectRoot: string
  cwd: string
  isInteractive: boolean
  clientType: string
  sessionSource?: string
}

export type RuntimeUsageSnapshot = {
  totalCostUSD: number
  totalApiDurationMs: number
  totalApiDurationWithoutRetriesMs: number
  totalToolDurationMs: number
  turnHookDurationMs: number
  turnToolDurationMs: number
  turnClassifierDurationMs: number
  turnHookCount: number
  turnToolCount: number
  turnClassifierCount: number
  totalLinesAdded: number
  totalLinesRemoved: number
  hasUnknownModelCost: boolean
  lastInteractionTime: number
  modelUsage: Readonly<Record<string, unknown>>
}

export type RuntimeExecutionBudgetState = {
  turnOutputTokens: number
  currentTurnTokenBudget: number | null
  budgetContinuationCount: number
  strictToolResultPairing: boolean
}

export type RuntimeExecutionPromptState = {
  mainLoopModelOverride: unknown
  initialMainLoopModel: unknown
  modelStrings: unknown
  cachedClaudeMdContent: string | null
  systemPromptSectionCache: ReadonlyMap<string, string | null>
  lastEmittedDate: string | null
  promptCache1hAllowlist: string[] | null
  promptCache1hEligible: boolean | null
  afkModeHeaderLatched: boolean | null
  fastModeHeaderLatched: boolean | null
  cacheEditingHeaderLatched: boolean | null
  thinkingClearLatched: boolean | null
  sdkBetas: string[] | undefined
}

export type RuntimeExecutionPromptStatePatch =
  Partial<RuntimeExecutionPromptState> & {
    systemPromptSection?: { name: string; value: string | null }
    clearSystemPromptSectionCache?: boolean
    clearHeaderLatches?: boolean
  }

export type RuntimeRequestDebugState = {
  lastApiRequest: unknown
  lastApiRequestMessages: unknown
  lastClassifierRequests: unknown[] | null
  promptId: string | null
  lastMainRequestId: string | undefined
  lastApiCompletionTimestamp: number | null
}

export type RuntimeRequestDebugStatePatch = Partial<RuntimeRequestDebugState>

export type RuntimeExecutionAppStateSlice = Pick<
  AppState,
  'toolPermissionContext' | 'fileHistory' | 'attribution' | 'fastMode'
>

export interface RuntimeBootstrapStateProvider {
  getSessionIdentity(): RuntimeSessionIdentity
  regenerateSessionId(options?: { setCurrentAsParent?: boolean }): string
  switchSession(sessionId: string, projectDir?: string | null): void
  setCwd(cwd: string): void
  setProjectRoot(projectRoot: string): void
  getUsageSnapshot(): RuntimeUsageSnapshot
  markInteraction(immediate?: boolean): void
  getExecutionBudget(): RuntimeExecutionBudgetState
  snapshotTurnBudget(budget: number | null): void
  incrementBudgetContinuationCount(): void
  getPromptState(): RuntimeExecutionPromptState
  patchPromptState(patch: RuntimeExecutionPromptStatePatch): void
  getRequestDebugState(): RuntimeRequestDebugState
  patchRequestDebugState(patch: RuntimeRequestDebugStatePatch): void
  markPostCompaction(): void
  consumePostCompaction(): boolean
  isSessionPersistenceDisabled(): boolean
}

export interface RuntimeAppStateProvider {
  getExecutionState(): RuntimeExecutionAppStateSlice
  getAppState(): AppState
  updateToolPermissionContext(
    updater: (
      prev: RuntimeExecutionAppStateSlice['toolPermissionContext'],
    ) => RuntimeExecutionAppStateSlice['toolPermissionContext'],
  ): void
  updateFileHistory(
    updater: (
      prev: RuntimeExecutionAppStateSlice['fileHistory'],
    ) => RuntimeExecutionAppStateSlice['fileHistory'],
  ): void
  updateAttribution(
    updater: (
      prev: RuntimeExecutionAppStateSlice['attribution'],
    ) => RuntimeExecutionAppStateSlice['attribution'],
  ): void
  setFastMode(value: RuntimeExecutionAppStateSlice['fastMode']): void
}

export interface RuntimeStateProviders {
  bootstrap: RuntimeBootstrapStateProvider
  app: RuntimeAppStateProvider
}
