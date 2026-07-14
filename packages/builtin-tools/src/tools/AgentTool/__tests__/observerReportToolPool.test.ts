import { describe, expect, test } from 'bun:test'
import { OBSERVER_REPORT_TOOL_NAME } from '../../ObserverReportTool/constants.js'
import {
  filterToolsForAgent,
  isObserverAgentToolPool,
  resolveAgentTools,
} from '../agentToolUtils.js'

function tool(name: string) {
  return { name } as any
}

describe('ObserverReport tool pool densable', () => {
  test('isObserverAgentToolPool from flag / querySource', () => {
    expect(isObserverAgentToolPool({})).toBe(false)
    expect(isObserverAgentToolPool({ isObserverAgent: true })).toBe(true)
    expect(
      isObserverAgentToolPool({ querySource: 'agent:observer:watcher' }),
    ).toBe(true)
    expect(isObserverAgentToolPool({ querySource: 'agent:worker' })).toBe(false)
  })

  test('filterToolsForAgent strips ObserverReport unless observer async', () => {
    const tools = [tool('Bash'), tool(OBSERVER_REPORT_TOOL_NAME), tool('Read')]

    const nonObsAsync = filterToolsForAgent({
      tools,
      isBuiltIn: true,
      isAsync: true,
      isObserverAgent: false,
    })
    expect(nonObsAsync.map(t => t.name)).not.toContain(
      OBSERVER_REPORT_TOOL_NAME,
    )

    const obsAsync = filterToolsForAgent({
      tools,
      isBuiltIn: true,
      isAsync: true,
      isObserverAgent: true,
    })
    expect(obsAsync.map(t => t.name)).toContain(OBSERVER_REPORT_TOOL_NAME)

    const obsSync = filterToolsForAgent({
      tools,
      isBuiltIn: true,
      isAsync: false,
      isObserverAgent: true,
    })
    expect(obsSync.map(t => t.name)).not.toContain(OBSERVER_REPORT_TOOL_NAME)
  })

  test('resolveAgentTools keeps ObserverReport only for observer async', () => {
    const available = [
      tool('Bash'),
      tool(OBSERVER_REPORT_TOOL_NAME),
      tool('Read'),
    ]
    const def = {
      tools: ['*'] as string[],
      source: 'built-in' as const,
    }

    const nonObs = resolveAgentTools(def, available, true, false, false)
    expect(nonObs.resolvedTools.map(t => t.name)).not.toContain(
      OBSERVER_REPORT_TOOL_NAME,
    )

    const obs = resolveAgentTools(def, available, true, false, true)
    expect(obs.resolvedTools.map(t => t.name)).toContain(
      OBSERVER_REPORT_TOOL_NAME,
    )
  })
})
