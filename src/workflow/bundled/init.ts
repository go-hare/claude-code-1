/**
 * Official initBundledWorkflows (2.1.207 yOy → IDd + CDd).
 * Registers product-shipped named workflows into the engine registry so
 * Workflow({ name }) works without a project file.
 *
 * - deep-research (IDd): public, self-contained research harness
 * - code-review (CDd): hidden — launched by /code-review skill at high/xhigh/max
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerBundledWorkflow } from '@claude-code/workflow-engine'

let initialized = false

export function initBundledWorkflows(): void {
  if (initialized) return
  initialized = true

  const dir = import.meta.dir

  registerBundledWorkflow(
    'deep-research',
    readFileSync(join(dir, 'deep-research.js'), 'utf-8'),
  )

  // Official CDd: pyo(..., { hidden: true }) — skill-launched only.
  registerBundledWorkflow(
    'code-review',
    readFileSync(join(dir, 'code-review.js'), 'utf-8'),
    { hidden: true },
  )
}

/** Test helper. */
export function __resetBundledWorkflowsInitForTests(): void {
  initialized = false
}
