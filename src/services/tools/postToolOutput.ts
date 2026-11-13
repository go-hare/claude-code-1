import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { AnyObject, Tool } from '../../Tool.js'

/** Validate the rewrite before remapping; never replace the original on failure. */
export function remapPostToolOutput<Input extends AnyObject, Output>(
  tool: Tool<Input, Output>,
  original: Output,
  rewritten: Output,
  toolUseID: string,
  onTransientError: (error: unknown) => void,
): { output: Output; block?: ToolResultBlockParam; error?: string } {
  try {
    const parsed = tool.outputSchema?.safeParse(rewritten)
    if (parsed && !parsed.success) {
      return { output: original, error: parsed.error.message }
    }
    let remapInput = rewritten
    if (tool.restoreTransientForRemap) {
      try {
        remapInput = tool.restoreTransientForRemap(original, rewritten)
      } catch (error) {
        onTransientError(error)
      }
    }
    const block = tool.mapToolResultToToolResultBlockParam(
      remapInput,
      toolUseID,
    )
    if (block === undefined) {
      return { output: original, error: 'mapper returned undefined' }
    }
    return { output: rewritten, block }
  } catch (error) {
    return {
      output: original,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
