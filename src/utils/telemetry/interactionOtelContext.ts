/**
 * densable 2.1.214 #41 — bridge between sessionTracing interaction ALS and
 * OTel event emit parent context, without circular imports.
 *
 * sessionTracing sets/clears the active interaction Context on start/end;
 * getOTelEventParentContext reads it when the active OTel context has no span.
 */

import type { Context } from '@opentelemetry/api'
import { RootSessionSlot } from '../hostSlot.js'
import { getBootstrapSession } from '../sessionRoot.js'

const interactionOtelContextSlot = new RootSessionSlot<{
  activeInteractionContext: Context | undefined
}>(() => ({
  activeInteractionContext: undefined,
}))

export function setActiveInteractionOTelContext(
  ctx: Context | undefined,
): void {
  interactionOtelContextSlot.of(
    getBootstrapSession(),
  ).activeInteractionContext = ctx
}

export function getActiveInteractionOTelContext(): Context | undefined {
  return interactionOtelContextSlot.of(getBootstrapSession())
    .activeInteractionContext
}
