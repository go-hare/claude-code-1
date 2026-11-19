/**
 * Retired migration (official 2.1.325 #2269).
 *
 * Previously rewrote `userSettings.model === 'sonnet[1m]'` to
 * `'sonnet-4-5-20250929[1m]'`, which caused new installs with `sonnet[1m]`
 * to be rewritten to a model ID rejected by the API.
 *
 * Kept as a no-op export for backwards compatibility with existing imports.
 */
export function migrateSonnet1mToSonnet45(): void {
  // Intentionally a no-op: do not rewrite `sonnet[1m]` on new installs.
}
