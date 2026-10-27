import type { SpinnerMode } from 'src/components/Spinner/types.js'

/** densable Phn/Ohr control event; every runAgent consumer must skip or apply it. */
export type RunAgentSpinnerMode = { type: 'spinner_mode'; mode: SpinnerMode }

export function isRunAgentSpinnerMode(message: {
  type: string
}): message is RunAgentSpinnerMode {
  return message.type === 'spinner_mode'
}
