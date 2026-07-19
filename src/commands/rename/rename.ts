import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { applyRename } from './applyRename.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  // densable wDy → xTo
  const { message } = await applyRename(args, context)
  onDone(message, { display: 'system' })
  return null
}
