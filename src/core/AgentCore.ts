import type {
  AgentCoreOptions,
  AgentCoreRuntimeContracts,
  AgentSessionOptions,
} from './types.js'
import { AgentSession } from './AgentSession.js'
import { createRuntimeToolCatalog } from '../runtime/capabilities/tools/ToolCatalog.js'

export class AgentCore {
  private readonly cwd: string
  private readonly executor: AgentCoreOptions['executor']
  private readonly runtimeContracts: AgentCoreRuntimeContracts
  private readonly sessions = new Map<string, AgentSession>()

  constructor(options: AgentCoreOptions) {
    this.cwd = options.cwd
    this.executor = options.executor
    this.runtimeContracts = {
      tools: createRuntimeToolCatalog(),
      toolPolicy: 'runtime/capabilities/tools/ToolPolicy',
      agentCapabilityPlane: 'runtime/capabilities/agents',
      coordinatorCapabilityPlane: 'runtime/capabilities/coordinator',
      hostAdapter: {
        kind: 'headless',
        name: 'agent-core',
        capabilities: ['session', 'turn', 'event-stream'],
      },
    }
  }

  createSession(options: Partial<AgentSessionOptions> = {}): AgentSession {
    const session = new AgentSession({
      cwd: options.cwd ?? this.cwd,
      id: options.id,
      executor: options.executor ?? this.executor,
    })
    this.sessions.set(session.id, session)
    return session
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId)
  }

  getRuntimeContracts(): AgentCoreRuntimeContracts {
    return this.runtimeContracts
  }

  dispose(): void {
    this.sessions.clear()
  }
}
