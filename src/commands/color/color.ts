import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { applyColor } from './applyColor.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  // densable: local-jsx shares Xfo with non-interactive Buy
  onDone(await applyColor(args, context), { display: 'system' })
  return null
}
