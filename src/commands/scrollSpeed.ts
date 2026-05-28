/**
 * /scroll-speed — Tune mouse wheel scroll speed with a live preview.
 */

import type { Command, LocalCommandResult } from '../types/command.js'

const scrollSpeed = {
  type: 'local',
  name: 'scroll-speed',
  description: 'Tune mouse wheel scroll speed (1-10)',
  argumentHint: '[<speed>]',
  immediate: true,
  supportsNonInteractive: false,
  load: () =>
    Promise.resolve({
      async call(args: string): Promise<LocalCommandResult> {
        const input = args.trim()

        if (!input) {
          const { getGlobalConfig } = await import('../utils/config.js')
          const config = getGlobalConfig()
          const current = (config as Record<string, unknown>).scrollSpeed ?? 3
          return {
            type: 'text',
            value: `Current scroll speed: ${current} (range: 1-10). Usage: /scroll-speed <number>`,
          }
        }

        const speed = parseInt(input, 10)
        if (Number.isNaN(speed) || speed < 1 || speed > 10) {
          return {
            type: 'text',
            value: 'Scroll speed must be a number between 1 and 10.',
          }
        }

        const { saveGlobalConfig } = await import('../utils/config.js')
        saveGlobalConfig(prev => ({ ...prev, scrollSpeed: speed }))

        return {
          type: 'text',
          value: `Scroll speed set to ${speed}. Scroll to test — adjust with /scroll-speed <1-10>.`,
        }
      },
    }),
} satisfies Command

export default scrollSpeed
