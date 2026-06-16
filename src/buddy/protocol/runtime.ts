import type {
  BuddyEvent,
  BuddyManifest,
  BuddyResponse,
  BuddyRuntime,
  BuddyRuntimeHook,
  BuddyState,
} from './types.js'

function normalizeResponses(
  value: BuddyResponse | BuddyResponse[] | void,
): BuddyResponse[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function eventState(event: BuddyEvent): BuddyState | undefined {
  switch (event.type) {
    case 'state.changed':
      return event.state
    case 'task.started':
    case 'task.progress':
      return 'running'
    case 'task.waiting':
      return 'waiting'
    case 'task.completed':
      return 'success'
    case 'task.failed':
      return 'failed'
    case 'buddy.pet':
      return 'pet'
    case 'assistant.message':
      return 'speaking'
    default:
      return undefined
  }
}

export function createBuddyRuntime(
  manifest: BuddyManifest,
  hook?: BuddyRuntimeHook,
): BuddyRuntime {
  return {
    manifest,
    state: 'idle',
    async dispatch(event: BuddyEvent): Promise<BuddyResponse[]> {
      const nextState = eventState(event)
      if (nextState && manifest.states[nextState]) this.state = nextState
      const hookResponses = normalizeResponses(await hook?.(event))
      return hookResponses
    },
  }
}

export async function dispatchBuddyEvent(
  runtime: BuddyRuntime,
  event: BuddyEvent,
): Promise<BuddyResponse[]> {
  return runtime.dispatch(event)
}
