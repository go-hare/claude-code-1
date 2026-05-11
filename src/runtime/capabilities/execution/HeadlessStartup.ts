import { createRuntimePromptStateProvider } from '../../core/state/bootstrapProvider.js'
import { filterAllowedSdkBetas } from '../../../utils/betas.js'

export type PrepareKernelHeadlessStartupOptions = {
  sessionPersistenceDisabled: boolean
  betas: string[]
  bareMode: boolean
  userType?: string
}

export type PrepareKernelHeadlessStartupDeps = {
  startDeferredPrefetches(): void
  logSessionTelemetry(): void
}

export async function prepareKernelHeadlessStartup(
  options: PrepareKernelHeadlessStartupOptions,
  deps: PrepareKernelHeadlessStartupDeps,
): Promise<void> {
  const runtimePromptStateProvider = createRuntimePromptStateProvider()

  runtimePromptStateProvider.patchPromptState({
    sdkBetas: filterAllowedSdkBetas(options.betas),
  })

  if (!options.bareMode) {
    deps.startDeferredPrefetches()
    void import('../../../utils/backgroundHousekeeping.js').then(module =>
      module.startBackgroundHousekeeping(),
    )
    if (options.userType === 'ant') {
      void import('../../../utils/sdkHeapDumpMonitor.js').then(module =>
        module.startSdkMemoryMonitor(),
      )
    }
  }

  deps.logSessionTelemetry()
}
