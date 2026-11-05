// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 `cc-plugin-sec-default` hooksModule (`m` / `ue`).
 */
export const LENIENCY = Object.freeze({ deny: 0, ask: 1, allow: 2 })
export const TIERS_HOLDING_USERS = Object.freeze(['user', 'prepend'])
export const UNCHECKED_DENY = Object.freeze({
  decision: 'deny',
  reason:
    'the deny rules in your settings could not be checked for this call, so it is refused',
})
export const USER_REACHABLE_TIERS = Object.freeze(['user', 'builtin', 'core'])
export const OWN_OPTIONS_PATH = [
  'pluginConfigs',
  'cc-plugin-sec-default@builtin',
  'options',
]
export const POLICY_MEMO_MS = 500
export const SOURCE = { source: 'policy' }
export const TOOL_REGISTER_REFUSAL =
  'allowedMcpServers (managed): plugins outside policy may not add tools'

export const admissionFailure = (name, err) =>
  `plugin.register hook failed judging ${name} (${err.kind}): ` +
  (err.message ?? 'no message')

export const isRuleDeny = answer =>
  answer.decision === 'deny' && answer.rule !== void 0

export const handedTo = (trace, idx) =>
  trace.slice(idx + 1).find(step => step.returned !== void 0)?.returned

export const isLooser = (mine, theirs) =>
  mine !== void 0 &&
  LENIENCY[mine.decision] > LENIENCY[theirs?.decision ?? 'deny']

export const loosenedByUsers = trace =>
  trace
    .filter(
      (step, idx) =>
        TIERS_HOLDING_USERS.includes(step.tier) &&
        isLooser(step.returned, handedTo(trace, idx)),
    )
    .map(step => step.plugin)

export function caughtAnswer(answer, trace) {
  return answer !== void 0 &&
    (answer.decision === 'deny' || loosenedByUsers(trace).length === 0)
    ? answer
    : UNCHECKED_DENY
}

export const heldNotice = (plugin, tool, rule) =>
  `${plugin} tried to lift a deny rule in your settings from a ${tool} call (${rule}); the deny rule holds over the plugins you install (allowModsToOverrideDenyRules)`

export const managedModsOnlyRefusal = name =>
  `mods are limited to your organization's by policy (allowManagedModsOnly); ${name} was not loaded`

export function pastUsers(event, next) {
  return USER_REACHABLE_TIERS.includes(event.provider?.tier)
    ? next(event)
    : next.to(event, 'append')
}

export function createPolicyMemo(ms, now = Date.now) {
  let stampedAt = Number.NEGATIVE_INFINITY
  let memo
  return read => {
    if (memo === void 0 || now() - stampedAt > ms) {
      stampedAt = now()
      memo = read()
    }
    return memo ?? read()
  }
}

export const decidedByPolicy = (promise, predicate) =>
  promise.then(predicate).catch(() => !0)

export function memberOf(obj, key) {
  return typeof obj === 'object' && obj !== null
    ? new Map(Object.entries(obj)).get(key)
    : void 0
}

export const ownOption = (settings, key) =>
  [...OWN_OPTIONS_PATH, key].reduce(memberOf, settings)

export const denyRulesHold = settings =>
  ownOption(settings, 'allowModsToOverrideDenyRules') !== !0

export const hasMcpAllowlist = settings =>
  Array.isArray(settings.allowedMcpServers)

export function isManagedModsOnly(settings) {
  const value = ownOption(settings, 'allowManagedModsOnly')
  return value !== void 0 && value !== !1
}

export function orgServerNames(settings) {
  const { allowedMcpServers, managedMcpServers } = settings
  const hasManagedMap =
    typeof managedMcpServers === 'object' && !Array.isArray(managedMcpServers)
  return [
    ...(Array.isArray(allowedMcpServers) ? allowedMcpServers : []).flatMap(
      entry => {
        const name =
          typeof entry === 'object' && entry !== null && 'serverName' in entry
            ? entry.serverName
            : void 0
        return typeof name === 'string' && name !== '' ? [name] : []
      },
    ),
    ...Object.keys(hasManagedMap ? (managedMcpServers ?? {}) : {}),
  ]
}

export const isOrgTool = (settings, toolName) =>
  orgServerNames(settings).some(server =>
    toolName.startsWith(`mcp__${server}__`),
  )

export function managedToolsRestored(settings, orgList, userList) {
  return settings === void 0 ||
    orgList.value === void 0 ||
    userList.value === void 0
    ? orgList
    : {
        value: [
          ...orgList.value.filter(tool => isOrgTool(settings, tool.name)),
          ...userList.value.filter(tool => !isOrgTool(settings, tool.name)),
        ],
      }
}

export function register(on) {
  const memo = createPolicyMemo(POLICY_MEMO_MS)
  const logged = new Set()
  on('classic.*', (_api, event, next) => next.to(event, 'append'))
  on('prompt.section', (_api, event, next) => next.to(event, 'append'))
  on('prompt.context', (_api, event, next) => next.to(event, 'append'))
  on('prompt.compose', (_api, event, next) => next.to(event, 'append'))
  on('skill.prompt', (_api, event, next) => next.to(event, 'append'))
  on('attribution.text', (_api, event, next) => next.to(event, 'append'))
  on('settings.read', (_api, event, next) => next.to(event, 'append'))
  on('tool.describe', (_api, event, next) => pastUsers(event, next))
  on('command.describe', (_api, event, next) => pastUsers(event, next))
  on('agent.offer', (_api, event, next) => pastUsers(event, next))
  on('agent.spawn', (_api, event, next) => pastUsers(event, next))
  on('tool.register', async (api, event, next) => {
    if (next.origin.tier === 'prepend' || next.origin.tier === 'append') {
      return next.to(event, 'append')
    }
    return next.origin.tier === 'user' &&
      (await decidedByPolicy(
        memo(() => api.settings.read(SOURCE)),
        hasMcpAllowlist,
      ))
      ? { deny: TOOL_REGISTER_REFUSAL }
      : next(event)
  })
  on('tool.list', async (api, event, next) =>
    managedToolsRestored(
      await memo(() => api.settings.read(SOURCE)).catch(() => {
        return
      }),
      await next.to(event, 'append'),
      await next(event),
    ),
  )
  on('tool.check', async (api, event, next) => {
    const answer = await next(event)
    const liftedBy = loosenedByUsers(next.trace)
    if (
      !(
        answer.decision !== 'deny' &&
        liftedBy.length > 0 &&
        (await decidedByPolicy(
          memo(() => api.settings.read(SOURCE)),
          denyRulesHold,
        ))
      )
    ) {
      return answer
    }
    const orgAnswer = await next.to(event, 'append')
    if (!isRuleDeny(orgAnswer)) return answer
    for (const plugin of liftedBy.filter(item => !logged.has(item))) {
      logged.add(plugin)
      api.ui.log(heldNotice(plugin, event.tool, orgAnswer.rule))
    }
    return orgAnswer
  }).catch(async (api, event, next) => {
    const orgAnswer = await next(event).catch(() => {
      return
    })
    return (await decidedByPolicy(
      memo(() => api.settings.read(SOURCE)),
      denyRulesHold,
    ))
      ? caughtAnswer(orgAnswer, next.trace)
      : orgAnswer
  })
  on('plugin.register', { tier: 'user' }, async (api, event, next) =>
    isManagedModsOnly(await api.settings.read(SOURCE))
      ? { refuse: managedModsOnlyRefusal(event.name) }
      : next(event),
  ).catch((api, event, next) => {
    api.ui.log(admissionFailure(event.name, next.error), { to: 'debug' })
    return next.called
      ? next(event)
      : { refuse: managedModsOnlyRefusal(event.name) }
  })
}

export default {
  LENIENCY,
  OWN_OPTIONS_PATH,
  POLICY_MEMO_MS,
  SOURCE,
  TIERS_HOLDING_USERS,
  TOOL_REGISTER_REFUSAL,
  UNCHECKED_DENY,
  USER_REACHABLE_TIERS,
  admissionFailure,
  caughtAnswer,
  createPolicyMemo,
  decidedByPolicy,
  denyRulesHold,
  handedTo,
  hasMcpAllowlist,
  heldNotice,
  isLooser,
  isManagedModsOnly,
  isOrgTool,
  isRuleDeny,
  loosenedByUsers,
  managedModsOnlyRefusal,
  managedToolsRestored,
  memberOf,
  orgServerNames,
  ownOption,
  pastUsers,
  register,
}
