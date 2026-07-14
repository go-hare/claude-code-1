/**
 * In-memory registry for product-bundled named workflows (official initBundledWorkflows / pyo).
 * Project `.claude/workflows/` still wins on name collision — disk is checked first.
 *
 * Official pyo(script, meta, { hidden }) — hidden workflows resolve by name (skill launch)
 * but are omitted from the default list surfaced to the model.
 */

type BundledEntry = {
  script: string
  hidden: boolean
}

const bundled = new Map<string, BundledEntry>()

/** Register or replace a bundled workflow script by name. */
export function registerBundledWorkflow(
  name: string,
  script: string,
  opts?: { hidden?: boolean },
): void {
  bundled.set(name, { script, hidden: opts?.hidden === true })
}

/** Look up a bundled workflow script. */
export function getBundledWorkflow(name: string): string | undefined {
  return bundled.get(name)?.script
}

/**
 * Names of registered bundled workflows (sorted).
 * By default omits hidden entries (official code-review is skill-only).
 */
export function listBundledWorkflows(opts?: {
  includeHidden?: boolean
}): string[] {
  const includeHidden = opts?.includeHidden === true
  return [...bundled.entries()]
    .filter(([, e]) => includeHidden || !e.hidden)
    .map(([name]) => name)
    .sort()
}

/** Test helper: clear the registry. */
export function clearBundledWorkflows(): void {
  bundled.clear()
}
