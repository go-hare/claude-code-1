/**
 * densable plugin-eval `ss`/`as`/`ls`/`Go`/`is` — recordings-on-disk replay pin.
 * Gold `async function ss(e,n,r,i)` SEA 212083274; pretty @720.
 * First minify `function ss()` @175941975 is Zod registry — skip that name.
 */

import { createHash } from 'crypto'
import { open, readdir } from 'fs/promises'
import { basename, dirname, join, relative } from 'path'
import { z } from 'zod/v4'
import { jsonStringify } from '../../slowOperations.js'
import { vetPluginEvalPath } from './pathVet.js'

const RECORDING_BYTES = 262_144
const OUTPUT_CHARS = 49_152
const PIN_CAP = 2000
const RECORDING_NAME = /^[A-Za-z0-9_-]+-[0-9a-f]{64}\.json$/

export const REPLAY_DIR = '.replay'

const recordingSchema = z.object({
  input: z.unknown(),
  output: z.string(),
  verdict: z.enum(['ok', 'tool_error', 'abort']),
  recordedAt: z.string(),
  model: z.string().nullable(),
})

export type ReplayPinMap = Record<string, string>

export type ReplayHit = {
  verdict: 'ok' | 'tool_error' | 'abort'
  text: string
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** densable `is`. */
export function recordingKey(params: {
  server: string
  tool: string
  input: unknown
  mockHash: string
  prompt: string
  history: Array<{ tool: string; input: unknown; verdict: string; output: string }>
}): string {
  const hist = sha256(
    params.history
      .map(
        h => jsonStringify([h.tool, jsonStringify(h.input) ?? '', h.verdict, h.output]) ?? '',
      )
      .join('\n'),
  )
  const promptHash = sha256(params.prompt.replaceAll('\r\n', '\n'))
  return sha256(
    [
      params.server,
      params.tool,
      jsonStringify(params.input) ?? 'null',
      params.mockHash,
      promptHash,
      hist,
    ].join(' '),
  )
}

/** densable `Go`. */
export function recordingFileName(tool: string, key: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(tool) || !/^[0-9a-f]+$/.test(key)) {
    throw new Error('recording name components must be plain segments')
  }
  return `${tool}-${key}.json`
}

async function readRecordingBytes(
  replayDir: string,
  name: string,
): Promise<Buffer | null> {
  try {
    const evalRoot = dirname(dirname(replayDir))
    await vetPluginEvalPath(
      evalRoot,
      relative(evalRoot, join(replayDir, name)),
      'mock replay recording',
    )
    const handle = await open(join(replayDir, name))
    try {
      const st = await handle.stat()
      if (!st.isFile() || st.size > RECORDING_BYTES) return null
      const buf = Buffer.alloc(st.size)
      let offset = 0
      while (offset < st.size) {
        const { bytesRead } = await handle.read({
          buffer: buf,
          offset,
          position: offset,
        })
        if (bytesRead <= 0) break
        offset += bytesRead
      }
      return buf.subarray(0, offset)
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/** densable `ss`. */
export async function readPinnedRecording(
  replayDir: string | undefined,
  tool: string,
  key: string,
  pinned: ReplayPinMap | undefined,
): Promise<ReplayHit | null> {
  if (replayDir === undefined || pinned === undefined) return null
  const name = recordingFileName(tool, key)
  const expected = pinned[name]
  if (expected === undefined) return null
  const bytes = await readRecordingBytes(replayDir, name)
  if (bytes === null || sha256(bytes) !== expected) return null
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
  const parsed = recordingSchema.safeParse(raw)
  if (!parsed.success || parsed.data.output.length > OUTPUT_CHARS) return null
  return { verdict: parsed.data.verdict, text: parsed.data.output }
}

/** densable `as`. */
export async function pinReplayRecordings(
  replayDir: string,
  notes: string[] = [],
): Promise<ReplayPinMap> {
  const pinned: ReplayPinMap = Object.create(null)
  const evalRoot = dirname(dirname(replayDir))
  try {
    await vetPluginEvalPath(
      evalRoot,
      relative(evalRoot, replayDir),
      'mock replay recordings',
    )
  } catch {
    return pinned
  }
  let names: string[]
  try {
    names = await readdir(replayDir)
  } catch {
    return pinned
  }
  const files = names.filter(n => RECORDING_NAME.test(n))
  if (files.length > PIN_CAP) {
    notes.push(
      `mocks: ${basename(dirname(replayDir))}/${basename(replayDir)} holds ${files.length} recordings; only the first ${PIN_CAP} are pinned for replay — prune ones no case reaches any more`,
    )
  }
  for (const name of files.slice(0, PIN_CAP)) {
    const bytes = await readRecordingBytes(replayDir, name)
    if (bytes !== null) pinned[name] = sha256(bytes)
  }
  return pinned
}

export { PIN_CAP }
