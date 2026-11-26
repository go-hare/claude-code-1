import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  ofDefaultHost,
} from '../../utils/sessionHost.js'
import type { InstinctCandidate } from './instinctParser.js'
import type { StoredSkillObservation } from './observationStore.js'
import type { SkillLearningProjectContext } from './types.js'

export type ObserverBackendContext = {
  project?: SkillLearningProjectContext
}

export type ObserverBackendResult =
  | InstinctCandidate[]
  | Promise<InstinctCandidate[]>

export interface ObserverBackend {
  readonly name: string
  analyze(
    observations: StoredSkillObservation[],
    ctx?: ObserverBackendContext,
  ): ObserverBackendResult
}

type ObserverBackendHostState = {
  registry: Map<string, ObserverBackend>
  activeName: string | undefined
}

// Module-load boot defaults (e.g. `sessionObserver.ts` registering `heuristic`
// and `llm` outside ALS). Fresh hosts inherit a shallow copy of these defaults
// while keeping all subsequent per-host registrations and selections isolated.
const bootDefaultRegistry = new Map<string, ObserverBackend>()
let bootDefaultActiveName: string | undefined

const observerBackendHostSlot = new HostSlot<ObserverBackendHostState>(() => ({
  registry: new Map(bootDefaultRegistry),
  activeName: bootDefaultActiveName,
}))

function getObserverBackendState(): ObserverBackendHostState {
  return observerBackendHostSlot.of(getBootstrapSessionHost())
}

export function registerObserverBackend(backend: ObserverBackend): void {
  const state = getObserverBackendState()
  state.registry.set(backend.name, backend)
  if (!state.activeName) state.activeName = backend.name
  if (getActiveSessionFromAls() === undefined) {
    bootDefaultRegistry.set(backend.name, backend)
    if (!bootDefaultActiveName) bootDefaultActiveName = backend.name
  }
}

/**
 * Register a built-in default observer backend so it seeds the boot-default
 * catalog, the process-default host, and the current host — even when the
 * providing module (`sessionObserver.ts`) is lazily dynamically imported for
 * the first time inside an active ALS session.
 */
export function registerDefaultObserverBackend(backend: ObserverBackend): void {
  bootDefaultRegistry.set(backend.name, backend)
  if (!bootDefaultActiveName) bootDefaultActiveName = backend.name

  const defaultState = ofDefaultHost(observerBackendHostSlot)
  defaultState.registry.set(backend.name, backend)
  if (!defaultState.activeName) defaultState.activeName = backend.name

  const currentState = getObserverBackendState()
  if (currentState !== defaultState) {
    currentState.registry.set(backend.name, backend)
    if (!currentState.activeName) currentState.activeName = backend.name
  }
}

export function setActiveObserverBackend(name: string): void {
  const state = getObserverBackendState()
  if (!state.registry.has(name)) {
    throw new Error(`Observer backend "${name}" is not registered`)
  }
  state.activeName = name
}

export function getActiveObserverBackend(): ObserverBackend {
  const state = getObserverBackendState()
  const backend = state.activeName
    ? state.registry.get(state.activeName)
    : undefined
  if (!backend) {
    throw new Error(
      'No observer backend is active — register one before analyzing observations',
    )
  }
  return backend
}

export function listObserverBackends(): string[] {
  return Array.from(getObserverBackendState().registry.keys())
}

export function resetObserverBackendsForTest(): void {
  const state = getObserverBackendState()
  state.registry.clear()
  state.activeName = undefined
  if (getActiveSessionFromAls() === undefined) {
    bootDefaultRegistry.clear()
    bootDefaultActiveName = undefined
  }
}

export async function analyzeWithActiveBackend(
  observations: StoredSkillObservation[],
  ctx?: ObserverBackendContext,
): Promise<InstinctCandidate[]> {
  return Promise.resolve(getActiveObserverBackend().analyze(observations, ctx))
}

function pickBackendFromEnv(): string | undefined {
  const raw = process.env.SKILL_LEARNING_OBSERVER_BACKEND?.trim()
  return raw && getObserverBackendState().registry.has(raw) ? raw : undefined
}

export function resolveDefaultObserverBackend(): ObserverBackend {
  const preferred = pickBackendFromEnv()
  if (preferred) setActiveObserverBackend(preferred)
  return getActiveObserverBackend()
}
