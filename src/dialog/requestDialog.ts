/**
 * densable Qg / Bgp / NEv / $Ev — typed requestDialog over a dialog mailbox.
 */
import type { z } from 'zod/v4'
import type { DialogMailbox, DialogRequestOptions } from './dialogMailbox.js'

export type DialogKindSpec<TPayload, TResult> = {
  kind: string
  payload: () => z.ZodType<TPayload>
  result: () => z.ZodType<TResult>
  default: TResult
}

/** densable Qg — identity */
export function defineDialogSpec<TPayload, TResult>(
  spec: DialogKindSpec<TPayload, TResult>,
): DialogKindSpec<TPayload, TResult> {
  return spec
}

export type RequestDialog = <TPayload, TResult>(
  spec: DialogKindSpec<TPayload, TResult>,
  payload: TPayload | AsyncIterable<TPayload>,
  options?: DialogRequestOptions,
) => Promise<TResult>

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  )
}

/** densable NEv — one-shot payload */
async function requestOnce<TPayload, TResult>(
  mailbox: DialogMailbox,
  spec: DialogKindSpec<TPayload, TResult>,
  payload: TPayload,
  options?: DialogRequestOptions,
): Promise<TResult> {
  const parsed = spec.payload().safeParse(payload)
  if (!parsed.success) return spec.default
  try {
    const { replied } = mailbox.request(
      { kind: spec.kind, payload: parsed.data },
      options,
    )
    const answer = await replied
    if ('cancelled' in answer) return spec.default
    const result = spec.result().safeParse(answer.result)
    return result.success ? result.data : spec.default
  } catch {
    return spec.default
  }
}

/** densable $Ev — streaming payload updates */
async function requestStreaming<TPayload, TResult>(
  mailbox: DialogMailbox,
  spec: DialogKindSpec<TPayload, TResult>,
  iterable: AsyncIterable<TPayload>,
  options?: DialogRequestOptions,
): Promise<TResult> {
  const iterator = iterable[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) return spec.default
  const parsed = spec.payload().safeParse(first.value)
  if (!parsed.success) {
    await iterator.return?.(undefined)
    return spec.default
  }

  const abort = new AbortController()
  const onOuterAbort = () => abort.abort()
  if (options?.signal) {
    if (options.signal.aborted) abort.abort()
    else options.signal.addEventListener('abort', onOuterAbort, { once: true })
  }

  const { replied, update } = mailbox.request(
    { kind: spec.kind, payload: parsed.data },
    { signal: abort.signal, queueBehind: options?.queueBehind },
  )

  let pumpError: unknown
  void (async () => {
    try {
      while (!abort.signal.aborted) {
        const next = await iterator.next()
        if (next.done) return
        if (abort.signal.aborted) return
        const nextParsed = spec.payload().safeParse(next.value)
        if (!nextParsed.success) continue
        update(nextParsed.data)
      }
    } catch (err) {
      pumpError = err
      abort.abort()
    }
  })().catch(() => {})

  let answer: Awaited<typeof replied>
  try {
    answer = await replied
  } finally {
    // densable: abort pump + o.return?.(void 0) without await (concurrent next/return hangs)
    abort.abort()
    options?.signal?.removeEventListener('abort', onOuterAbort)
    void iterator.return?.(undefined)
  }
  if (pumpError !== undefined) throw pumpError
  if ('cancelled' in answer) return spec.default
  const result = spec.result().safeParse(answer.result)
  return result.success ? result.data : spec.default
}

/** densable Bgp(mailbox) */
export function createRequestDialog(mailbox: DialogMailbox): RequestDialog {
  return async (spec, payload, options) => {
    if (isAsyncIterable(payload)) {
      return requestStreaming(mailbox, spec, payload, options)
    }
    return requestOnce(mailbox, spec, payload, options)
  }
}
