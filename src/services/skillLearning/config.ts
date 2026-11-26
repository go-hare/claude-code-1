import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'

export type SkillLearningLlmConfig = {
  readonly timeoutMs: number
  readonly maxCallsPerSession: number
  readonly cooldownMs: number
  readonly failureThreshold: number
  readonly circuitCooldownMs: number
}

export type SkillLearningConfig = {
  readonly minConfidence: number
  readonly minClusterSize: number
  readonly llm: SkillLearningLlmConfig
}

export type SkillLearningConfigOverrides = {
  minConfidence?: number
  minClusterSize?: number
  llm?: Partial<SkillLearningLlmConfig>
}

const DEFAULTS: SkillLearningConfig = {
  minConfidence: 0.75,
  minClusterSize: 3,
  llm: {
    timeoutMs: 10_000,
    maxCallsPerSession: 20,
    cooldownMs: 30_000,
    failureThreshold: 3,
    circuitCooldownMs: 60_000,
  },
}

const configHostSlot = new HostSlot<{
  overrides: SkillLearningConfigOverrides | undefined
}>(() => ({
  overrides: undefined,
}))

export function getSkillLearningConfig(): SkillLearningConfig {
  const { overrides } = configHostSlot.of(getBootstrapSessionHost())
  if (!overrides) return DEFAULTS
  return {
    minConfidence: overrides.minConfidence ?? DEFAULTS.minConfidence,
    minClusterSize: overrides.minClusterSize ?? DEFAULTS.minClusterSize,
    llm: { ...DEFAULTS.llm, ...overrides.llm },
  }
}

export function setSkillLearningConfigForTest(
  config: SkillLearningConfigOverrides,
): void {
  configHostSlot.of(getBootstrapSessionHost()).overrides = config
}

export function resetSkillLearningConfig(): void {
  configHostSlot.of(getBootstrapSessionHost()).overrides = undefined
}
