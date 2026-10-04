import { describe, expect, test } from 'bun:test'
import { evalSpawnCgroupExtras } from '../pluginEval/evalCgroup.js'
import { resolveToolMemoryCgroupForSpawn } from '../../shell/toolMemoryCgroup.js'

describe('evalSpawnCgroupExtras densable la 2.1.283', () => {
  test('undefined Qfp yields empty extras for agent and plugin', () => {
    const dir = resolveToolMemoryCgroupForSpawn(true)
    const agent = evalSpawnCgroupExtras('agent')
    const plugin = evalSpawnCgroupExtras('plugin')
    if (dir === undefined) {
      expect(agent).toEqual({})
      expect(plugin).toEqual({})
      expect('cgroup' in agent).toBe(false)
    } else {
      expect(agent).toEqual({ cgroup: dir })
      expect(plugin).toEqual({ cgroup: dir })
    }
  })

  test('kind is accepted for gold la("agent") / la("plugin") signature', () => {
    expect(() => evalSpawnCgroupExtras('agent')).not.toThrow()
    expect(() => evalSpawnCgroupExtras('plugin')).not.toThrow()
  })
})
