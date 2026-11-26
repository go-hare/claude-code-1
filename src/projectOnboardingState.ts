import { join } from 'path'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { getCwd } from './utils/cwd.js'
import { isDirEmpty } from './utils/file.js'
import { getFsImplementation } from './utils/fsOperations.js'
import { getBootstrapSession, RootSessionSlot } from './utils/sessionHost.js'

export type Step = {
  key: string
  text: string
  isComplete: boolean
  isCompletable: boolean
  isEnabled: boolean
}

export function getSteps(): Step[] {
  const hasClaudeMd = getFsImplementation().existsSync(
    join(getCwd(), 'CLAUDE.md'),
  )
  const isWorkspaceDirEmpty = isDirEmpty(getCwd())

  return [
    {
      key: 'workspace',
      text: 'Ask Claude to create a new app or clone a repository',
      isComplete: false,
      isCompletable: true,
      isEnabled: isWorkspaceDirEmpty,
    },
    {
      key: 'claudemd',
      text: 'Run /init to create a CLAUDE.md file with instructions for Claude',
      isComplete: hasClaudeMd,
      isCompletable: true,
      isEnabled: !isWorkspaceDirEmpty,
    },
  ]
}

export function isProjectOnboardingComplete(): boolean {
  return getSteps()
    .filter(({ isCompletable, isEnabled }) => isCompletable && isEnabled)
    .every(({ isComplete }) => isComplete)
}

export function maybeMarkProjectOnboardingComplete(): void {
  // Short-circuit on cached config — isProjectOnboardingComplete() hits
  // the filesystem, and REPL.tsx calls this on every prompt submit.
  if (getCurrentProjectConfig().hasCompletedProjectOnboarding) {
    return
  }
  if (isProjectOnboardingComplete()) {
    saveCurrentProjectConfig(current => ({
      ...current,
      hasCompletedProjectOnboarding: true,
    }))
  }
}

const fallbackOnboardingRootObj: object = {}
const fallbackOnboardingSession = { root: fallbackOnboardingRootObj }

function getActiveOnboardingSession(): { readonly root: object } {
  try {
    const session = getBootstrapSession()
    if (session?.root) {
      return session
    }
  } catch {
    // Fall back to module-local sentinel if sessionHost is mocked
  }
  return fallbackOnboardingSession
}

function resolveOnboardingMemoKey(key: unknown): unknown {
  return key === undefined ? getCwd() : key
}

class OnboardingCwdMemoMap extends Map<unknown, boolean> {
  override get(key: unknown): boolean | undefined {
    return super.get(resolveOnboardingMemoKey(key))
  }
  override has(key: unknown): boolean {
    return super.has(resolveOnboardingMemoKey(key))
  }
  override set(key: unknown, value: boolean): this {
    return super.set(resolveOnboardingMemoKey(key), value)
  }
  override delete(key: unknown): boolean {
    return super.delete(resolveOnboardingMemoKey(key))
  }
}

const shouldShowProjectOnboardingBySession = new RootSessionSlot<
  Map<unknown, boolean>
>(() => new OnboardingCwdMemoMap())

function computeShouldShowProjectOnboarding(): boolean {
  const projectConfig = getCurrentProjectConfig()
  // Short-circuit on cached config before isProjectOnboardingComplete()
  // hits the filesystem — this runs during first render.
  if (
    projectConfig.hasCompletedProjectOnboarding ||
    projectConfig.projectOnboardingSeenCount >= 4 ||
    process.env.IS_DEMO
  ) {
    return false
  }

  return !isProjectOnboardingComplete()
}

function createShouldShowProjectOnboarding() {
  const fn = Object.assign(
    function shouldShowProjectOnboarding(): boolean {
      const cache = shouldShowProjectOnboardingBySession.of(
        getActiveOnboardingSession(),
      )
      const key = getCwd()
      if (cache.has(key)) {
        return cache.get(key)!
      }
      const computed = computeShouldShowProjectOnboarding()
      cache.set(key, computed)
      return computed
    },
    {
      cache: new Map<unknown, boolean>(),
    },
  )
  Object.defineProperty(fn, 'cache', {
    configurable: true,
    enumerable: true,
    get(): Map<unknown, boolean> {
      return shouldShowProjectOnboardingBySession.of(
        getActiveOnboardingSession(),
      )
    },
    set(next: Map<unknown, boolean>): void {
      const cache = shouldShowProjectOnboardingBySession.of(
        getActiveOnboardingSession(),
      )
      cache.clear()
      for (const [k, v] of next) {
        cache.set(k, v)
      }
    },
  })
  return fn
}

export const shouldShowProjectOnboarding = createShouldShowProjectOnboarding()

export function incrementProjectOnboardingSeenCount(): void {
  saveCurrentProjectConfig(current => ({
    ...current,
    projectOnboardingSeenCount: current.projectOnboardingSeenCount + 1,
  }))
}
