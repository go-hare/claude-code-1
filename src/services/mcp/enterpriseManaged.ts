import type { ConfigScope } from './types.js'

/**
 * densable 2.1.243 #7 — org-managed claude.ai connector.
 * Official: transport==="claudeai-proxy" && scope==="claudeai" && enterpriseManaged
 */
export function isEnterpriseManagedClaudeAiConnector(input: {
  transport?: string
  scope?: ConfigScope | string
  enterpriseManaged?: boolean
}): boolean {
  return (
    input.transport === 'claudeai-proxy' &&
    input.scope === 'claudeai' &&
    input.enterpriseManaged === true
  )
}
