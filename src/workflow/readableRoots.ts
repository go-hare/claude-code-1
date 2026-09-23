/** Directories besides the project root that a workflow scriptPath may read. */
export function workflowReadableRoots(): string[] {
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/settings/settings.js') as typeof import('../utils/settings/settings.js')
    const dirs = getInitialSettings()?.permissions?.additionalDirectories
    if (!Array.isArray(dirs)) return []
    return dirs.filter((dir): dir is string => typeof dir === 'string')
  } catch {
    return []
  }
}
