/**
 * densable 2.1.214 #41 — bridge between sessionTracing interaction ALS and
 * OTel event emit parent context, without circular imports.
 *
 * sessionTracing sets/clears the active interaction Context on start/end;
 * getOTelEventParentContext reads it when the active OTel context has no span.
 */

import type { Context } from '@opentelemetry/api'

let activeInteractionContext: Context | undefined

export function setActiveInteractionOTelContext(
  ctx: Context | undefined,
): void {
  activeInteractionContext = ctx
}

export function getActiveInteractionOTelContext(): Context | undefined {
  return activeInteractionContext
}
