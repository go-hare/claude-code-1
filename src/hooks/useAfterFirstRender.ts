import { useEffect } from 'react'
import { isExitAfterFirstRenderEnabled } from '../utils/residualFinalEnvGates.js'

export function useAfterFirstRender(): void {
  useEffect(() => {
    // Official EXIT_AFTER_FIRST_RENDER densable — ant-only startup bench exit.
    if (process.env.USER_TYPE === 'ant' && isExitAfterFirstRenderEnabled()) {
      process.stderr.write(
        `\nStartup time: ${Math.round(process.uptime() * 1000)}ms\n`,
      )
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(0)
    }
  }, [])
}
