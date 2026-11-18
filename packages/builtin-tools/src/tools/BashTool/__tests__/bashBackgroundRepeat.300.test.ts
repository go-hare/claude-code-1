import { describe, expect, test } from 'bun:test'
import { BashTool, findMatchingBackgroundShellTask } from '../BashTool.js'

describe('BashTool background command repeat guard (#795)', () => {
  const runningBgTask = {
    id: 'bash-bg-1',
    type: 'local_bash',
    command: 'npm run dev',
    status: 'running',
    isBackgrounded: true,
    caller: 'turn',
    toolUseId: 'tu-1',
    shellCommand: { status: 'backgrounded' },
    startTime: Date.now() - 5000,
    outputFile: '/tmp/bash-bg-1.out',
    agentId: undefined,
  } as any

  test('findMatchingBackgroundShellTask matches running backgrounded bash task with same command', () => {
    const match = findMatchingBackgroundShellTask(
      {
        command: '  npm run dev  ',
        cwd: process.cwd(),
        agentId: undefined,
        toolUseId: 'tu-2',
      },
      { 'bash-bg-1': runningBgTask },
    )
    expect(match?.id).toBe('bash-bg-1')
  })

  test('BashTool.validateInput blocks repeating a command already running in background with errorCode 15', async () => {
    const res = await BashTool.validateInput!(
      { command: 'npm run dev' } as any,
      {
        agentId: undefined,
        toolUseId: 'tu-2',
        getAppState: () => ({ tasks: { 'bash-bg-1': runningBgTask } }) as any,
        options: {
          tools: [{ name: 'TaskStop' } as any],
        } as any,
      } as any,
    )
    expect(res.result).toBe(false)
    if (!res.result) {
      expect(res.errorCode).toBe(15)
      expect(res.message).toContain('TaskStop')
      expect(res.message).toContain('/tmp/bash-bg-1.out')
    }
  })
})
