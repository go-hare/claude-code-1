import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(onDone: LocalJSXCommandOnDone): Promise<undefined> {
  onDone('Output style moved to /config', { display: 'system' })
}
