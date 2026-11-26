import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'

export type ProgramUseCaseChoice = {
  id: string
  name: string
  description?: string
}

export type ProgramUseCaseChoiceMode = 'per_user' | 'per_grant'

const USE_CASE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

type UseCaseStoreHostState = {
  offeredChoices: ProgramUseCaseChoice[]
  choiceMode: ProgramUseCaseChoiceMode
  sessionSelectedUseCaseId: string | null
}

/** Official 2.1.331 `[W-67]` — HostSlot-scoped program use-case choices & selection. */
const useCaseStoreHostSlot = new HostSlot<UseCaseStoreHostState>(() => ({
  offeredChoices: [],
  choiceMode: 'per_user',
  sessionSelectedUseCaseId: null,
}))

function getUseCaseStoreHostState(): UseCaseStoreHostState {
  return useCaseStoreHostSlot.of(getBootstrapSessionHost())
}

export function getProgramUseCaseChoices(): readonly ProgramUseCaseChoice[] {
  return getUseCaseStoreHostState().offeredChoices
}

export function setProgramUseCaseChoices(
  choices: readonly ProgramUseCaseChoice[],
  mode: ProgramUseCaseChoiceMode = 'per_user',
): void {
  const hostState = getUseCaseStoreHostState()
  hostState.offeredChoices = [...choices]
  hostState.choiceMode = mode
}

export function getProgramUseCaseChoiceMode(): ProgramUseCaseChoiceMode {
  return getUseCaseStoreHostState().choiceMode
}

export function getEnvLockedProgramUseCaseId(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_PROGRAM_USE_CASE_ID
  if (!raw || !USE_CASE_ID_RE.test(raw)) return null
  return raw
}

export function getProgramUseCaseFilePath(
  configDir: string = getClaudeConfigHomeDir(),
): string {
  return join(configDir, 'program-use-case.json')
}

export function readSavedProgramUseCaseId(
  configDir: string = getClaudeConfigHomeDir(),
): string | null {
  try {
    const filePath = getProgramUseCaseFilePath(configDir)
    if (!existsSync(filePath)) return null
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      useCaseId?: unknown
    }
    return typeof parsed.useCaseId === 'string' && parsed.useCaseId.length > 0
      ? parsed.useCaseId
      : null
  } catch {
    return null
  }
}

export function getCurrentProgramUseCaseId(
  configDir: string = getClaudeConfigHomeDir(),
): string | null {
  return (
    getEnvLockedProgramUseCaseId() ??
    getUseCaseStoreHostState().sessionSelectedUseCaseId ??
    readSavedProgramUseCaseId(configDir)
  )
}

export function selectProgramUseCase(
  useCaseId: string,
  configDir: string = getClaudeConfigHomeDir(),
): 'saved' | 'session_only' | 'not_offered' {
  const hostState = getUseCaseStoreHostState()
  if (!hostState.offeredChoices.some(c => c.id === useCaseId)) {
    return 'not_offered'
  }
  hostState.sessionSelectedUseCaseId = useCaseId
  try {
    const filePath = getProgramUseCaseFilePath(configDir)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(
      filePath,
      `${JSON.stringify({ useCaseId }, null, 2)}\n`,
      'utf8',
    )
    return 'saved'
  } catch {
    return 'session_only'
  }
}

export function forgetSavedProgramUseCase(
  configDir: string = getClaudeConfigHomeDir(),
): boolean {
  getUseCaseStoreHostState().sessionSelectedUseCaseId = null
  try {
    const filePath = getProgramUseCaseFilePath(configDir)
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true })
    }
    return true
  } catch {
    return false
  }
}

export function resetProgramUseCaseStoreForTesting(): void {
  const hostState = getUseCaseStoreHostState()
  hostState.offeredChoices = []
  hostState.choiceMode = 'per_user'
  hostState.sessionSelectedUseCaseId = null
}
