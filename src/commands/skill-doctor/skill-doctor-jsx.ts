/**
 * densable `q0e` twin: gold has no jsx load — the host posts the text report.
 * Local Command type requires load(); this posts the same `qsr` report as system.
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { call as textCall } from './skill-doctor.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  const result = await textCall('', context)
  const value = result.type === 'text' ? result.value : ''
  onDone(value, { display: 'system' })
  return null
}
