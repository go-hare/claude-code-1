/**
 * densable `Zt` / `Xi` / `k.host`. Official `Xi()` mints `new Zt({… new Yt …})`.
 * Slot classes (`Yt`/`jt`/`qt`/…) are UNKNOWN — leftover-wired as empty
 * objects, not invented slot bodies. `fn`/`bn` stay UNKNOWN.
 *
 * `getReplDiffHost()` is `k.host` (one `Xi()` per process). Forks share
 * `root.host`; this is not a Map-by-sessionId stand-in.
 */

export class SessionHost {
  backgroundHousekeeping: object
  launchOptions: object
  settingsSource: object
  extensionsConfig: object
  modelStringsCache: object
  diagnostics: object
  telemetryHandles: object
  credentialSlots: object
  mcpProcessWiring: object
  requestLatches: object
  accountCreditLatches: object
  proactivity: object

  constructor(e: {
    backgroundHousekeeping: object
    launchOptions: object
    settingsSource: object
    extensionsConfig: object
    modelStringsCache: object
    diagnostics: object
    telemetryHandles: object
    credentialSlots: object
    mcpProcessWiring: object
    requestLatches: object
    accountCreditLatches: object
    proactivity: object
  }) {
    this.backgroundHousekeeping = e.backgroundHousekeeping
    this.launchOptions = e.launchOptions
    this.settingsSource = e.settingsSource
    this.extensionsConfig = e.extensionsConfig
    this.modelStringsCache = e.modelStringsCache
    this.diagnostics = e.diagnostics
    this.telemetryHandles = e.telemetryHandles
    this.credentialSlots = e.credentialSlots
    this.mcpProcessWiring = e.mcpProcessWiring
    this.requestLatches = e.requestLatches
    this.accountCreditLatches = e.accountCreditLatches
    this.proactivity = e.proactivity
  }
}

/** densable `Xi()`. Slot classes UNKNOWN — empty bags only. */
export function createSessionHost(): SessionHost {
  return new SessionHost({
    backgroundHousekeeping: {},
    launchOptions: {},
    settingsSource: {},
    extensionsConfig: {},
    modelStringsCache: {},
    diagnostics: {},
    telemetryHandles: {},
    credentialSlots: {},
    mcpProcessWiring: {},
    requestLatches: {},
    accountCreditLatches: {},
    proactivity: {},
  })
}

let bootstrapHost: SessionHost | undefined

/** densable `k.host` from `k=es()` → `Li({host:Xi(),…})`. */
export function getBootstrapSessionHost(): SessionHost {
  return (bootstrapHost ??= createSessionHost())
}

/** densable `session.host` / `k.host`. */
export function getReplDiffHost(): object {
  return getBootstrapSessionHost()
}

export function resetSessionHostForTests(): void {
  bootstrapHost = undefined
}
