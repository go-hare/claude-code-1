/**
 * ACP session/request_permission presentation — permission-extension.md
 * version 1. Official ACP server puts this on RequestPermissionRequest._meta.
 */
export function buildPermissionRequestMeta(args: {
  toolName: string
  title: string
  decisionReason?: string
}): {
  permission: {
    version: 1
    title: string
    description?: string
  }
} {
  const heading =
    args.toolName === 'ExitPlanMode' ? 'Ready to code?' : args.title
  const title = compactText(heading, 4000) ?? 'Use tool?'
  const reason = compactText(args.decisionReason, 4000)
  return {
    permission: {
      version: 1,
      title,
      ...(reason ? { description: `Reason: ${reason}` } : {}),
    },
  }
}

function compactText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}
