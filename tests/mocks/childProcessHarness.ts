/**
 * Shared `node:child_process` mock. Last-write-wins means only one factory
 * is live; every share/issue suite must register this same harness and
 * activate stubs via `setChildProcessStubs` in beforeAll.
 */
import { mock } from 'bun:test'
import { promisify } from 'node:util'

export type ExecFileCb = (
  err: Error | null,
  stdout: string,
  stderr: string,
) => void
export type ExecFileImpl = (
  cmd: string,
  args: string[],
  opts: unknown,
  cb: ExecFileCb,
) => void
export type ExecFileSyncImpl = (
  cmd: string,
  args: string[],
  opts?: unknown,
) => Buffer

type Slot = {
  execFile?: ExecFileImpl
  execFileSync?: ExecFileSyncImpl
}

const slots = new Map<string, Slot>()

export function setChildProcessStubs(id: string, slot: Slot): void {
  slots.set(id, slot)
}

export function clearChildProcessStubs(id: string): void {
  slots.delete(id)
}

function activeSlot(): Slot | undefined {
  let last: Slot | undefined
  for (const slot of slots.values()) last = slot
  return last
}

export function installChildProcessHarness(): void {
  mock.module('node:child_process', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const real = require('node:child_process') as Record<string, unknown>
    const execFile = ((...args: unknown[]) => {
      const slot = activeSlot()
      if (slot?.execFile) {
        return slot.execFile(
          args[0] as string,
          args[1] as string[],
          args[2],
          args[3] as ExecFileCb,
        )
      }
      return (real.execFile as (...a: unknown[]) => unknown)(...args)
    }) as unknown as typeof real.execFile & Record<symbol, unknown>

    ;(execFile as Record<symbol, unknown>)[promisify.custom as symbol] = (
      cmd: string,
      args: string[],
      opts: unknown,
    ): Promise<{ stdout: string; stderr: string }> => {
      const slot = activeSlot()
      if (slot?.execFile) {
        return new Promise((resolve, reject) =>
          slot.execFile!(cmd, args, opts, (err, stdout, stderr) =>
            err ? reject(err) : resolve({ stdout, stderr }),
          ),
        )
      }
      return promisify(real.execFile as never)(cmd, args, opts) as Promise<{
        stdout: string
        stderr: string
      }>
    }

    const execFileSync = ((...args: unknown[]) => {
      const slot = activeSlot()
      if (slot?.execFileSync) {
        return slot.execFileSync(
          args[0] as string,
          args[1] as string[],
          args[2],
        )
      }
      return (real.execFileSync as (...a: unknown[]) => unknown)(...args)
    }) as typeof real.execFileSync

    return {
      ...real,
      default: real,
      execFile,
      execFileSync,
    }
  })
}
