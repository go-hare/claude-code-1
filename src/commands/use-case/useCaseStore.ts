import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type ProgramUseCaseChoice = {
  id: string
  name: string
  description?: string
}

export type ProgramUseCaseChoiceMode = 'per_user' | 'per_grant'

const USE_CASE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

let offeredChoices: ProgramUseCaseChoice[] = []
let choiceMode: ProgramUseCaseChoiceMode = 'per_user'
let sessionSelectedUseCaseId: string | null = null

export function getProgramUseCaseChoices(): readonly ProgramUseCaseChoice[] {
  return offeredChoices
}

export function setProgramUseCaseChoices(
  choices: readonly ProgramUseCaseChoice[],
  mode: ProgramUseCaseChoiceMode = 'per_user',
): void {
  offeredChoices = [...choices]
  choiceMode = mode
}

export function getProgramUseCaseChoiceMode(): ProgramUseCaseChoiceMode {
  return choiceMode
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
    sessionSelectedUseCaseId ??
    readSavedProgramUseCaseId(configDir)
  )
}

export function selectProgramUseCase(
  useCaseId: string,
  configDir: string = getClaudeConfigHomeDir(),
): 'saved' | 'session_only' | 'not_offered' {
  if (!offeredChoices.some(c => c.id === useCaseId)) {
    return 'not_offered'
  }
  sessionSelectedUseCaseId = useCaseId
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
  sessionSelectedUseCaseId = null
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
  offeredChoices = []
  choiceMode = 'per_user'
  sessionSelectedUseCaseId = null
}
