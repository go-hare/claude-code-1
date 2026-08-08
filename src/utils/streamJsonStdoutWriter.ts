/**
 * densable 2.1.219 `_Is` / `Yud` — process-global stream-json / SDK stdout writer.
 *
 * print.ts registers StructuredIO/RemoteIO when outputFormat is stream-json (or
 * sdkUrl is set). Background agents (runAgent isAsync) pull the writer via
 * getStreamJsonStdoutWriter() to emit nested agent_progress frames that would
 * otherwise never reach stdout (async agents are detached from the parent
 * onProgress callback).
 */
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

export type StreamJsonStdoutWriter = {
  write(message: StdoutMessage): Promise<void>
}

let streamJsonStdoutWriter: StreamJsonStdoutWriter | undefined

/** densable `_Is(e)` */
export function setStreamJsonStdoutWriter(
  writer: StreamJsonStdoutWriter | undefined,
): void {
  streamJsonStdoutWriter = writer
}

/** densable `Yud()` */
export function getStreamJsonStdoutWriter():
  | StreamJsonStdoutWriter
  | undefined {
  return streamJsonStdoutWriter
}
