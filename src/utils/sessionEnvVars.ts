import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'

/**
 * Session-scoped environment variables set via /env.
 * Applied only to spawned child processes (via bash provider env overrides),
 * not to the REPL process itself.
 */
const sessionEnvVarsSlot = new RootSessionSlot<Map<string, string>>(
  () => new Map<string, string>(),
)

function getSessionEnvVarsMap(): Map<string, string> {
  return sessionEnvVarsSlot.of(getBootstrapSession())
}

export function getSessionEnvVars(): ReadonlyMap<string, string> {
  return getSessionEnvVarsMap()
}

export function setSessionEnvVar(name: string, value: string): void {
  getSessionEnvVarsMap().set(name, value)
}

export function deleteSessionEnvVar(name: string): void {
  getSessionEnvVarsMap().delete(name)
}

export function clearSessionEnvVars(): void {
  getSessionEnvVarsMap().clear()
}
