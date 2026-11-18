import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

const PROVIDER_ENV_FLAGS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
] as const

const CLEARED_PROVIDER_ENV = Object.fromEntries(
  PROVIDER_ENV_FLAGS.map(k => [k, undefined]),
) as unknown as Record<string, string>

function clearProcessProviderFlags(): void {
  for (const key of PROVIDER_ENV_FLAGS) {
    delete process.env[key]
  }
}

function getEnvVarForProvider(provider: string): string {
  switch (provider) {
    case 'bedrock':
      return 'CLAUDE_CODE_USE_BEDROCK'
    case 'vertex':
      return 'CLAUDE_CODE_USE_VERTEX'
    case 'foundry':
      return 'CLAUDE_CODE_USE_FOUNDRY'
    case 'gemini':
      return 'CLAUDE_CODE_USE_GEMINI'
    case 'grok':
      return 'CLAUDE_CODE_USE_GROK'
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

// Get merged env: process.env + settings.env (from userSettings)
function getMergedEnv(): Record<string, string> {
  const settings = getSettings_DEPRECATED()
  const merged: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  )
  if (settings?.env) {
    Object.assign(merged, settings.env)
  }
  return merged
}

function getMissingCredentialWarning(arg: string): string | null {
  const mergedEnv = getMergedEnv()
  if (arg === 'openai') {
    const hasChatGPTAuth = mergedEnv.OPENAI_AUTH_MODE === 'chatgpt'
    const hasKey = !!mergedEnv.OPENAI_API_KEY
    const hasUrl = !!mergedEnv.OPENAI_BASE_URL
    if (!hasChatGPTAuth && (!hasKey || !hasUrl)) {
      const missing: string[] = []
      if (!hasKey) missing.push('OPENAI_API_KEY')
      if (!hasUrl) missing.push('OPENAI_BASE_URL')
      return `Warning: Missing env vars: ${missing.join(', ')}\nConfigure them via settings.json env or set manually.`
    }
  } else if (arg === 'grok') {
    const hasKey = !!(mergedEnv.GROK_API_KEY || mergedEnv.XAI_API_KEY)
    if (!hasKey) {
      return 'Warning: Missing env var: GROK_API_KEY (or XAI_API_KEY)\nConfigure it via settings.json env or set manually.'
    }
  } else if (arg === 'gemini') {
    if (!mergedEnv.GEMINI_API_KEY) {
      return 'Warning: Missing env var: GEMINI_API_KEY\nConfigure it via settings.json env or set manually.'
    }
  }
  return null
}

const call: LocalCommandCall = async (args, _context) => {
  const arg = args.trim().toLowerCase()

  // No argument: show current provider
  if (!arg) {
    const current = getAPIProvider()
    return { type: 'text', value: `Current API provider: ${current}` }
  }

  // unset - clear settings, fallback to env vars
  if (arg === 'unset') {
    updateSettingsForSource('userSettings', {
      modelType: undefined,
      env: CLEARED_PROVIDER_ENV,
    })
    clearProcessProviderFlags()
    return {
      type: 'text',
      value: 'API provider cleared (will use environment variables).',
    }
  }

  // Validate provider
  const validProviders = [
    'anthropic',
    'openai',
    'gemini',
    'grok',
    'bedrock',
    'vertex',
    'foundry',
  ]
  if (!validProviders.includes(arg)) {
    return {
      type: 'text',
      value: `Invalid provider: ${arg}\nValid: ${validProviders.join(', ')}`,
    }
  }

  if (
    arg === 'anthropic' ||
    arg === 'openai' ||
    arg === 'gemini' ||
    arg === 'grok'
  ) {
    const warning = getMissingCredentialWarning(arg)
    // Clear any cloud / third-party provider env vars to avoid conflicts
    clearProcessProviderFlags()
    // Update settings.json — also strip persisted USE_* flags from settings.env
    // so applyConfigEnvironmentVariables() cannot re-pin a previous provider.
    updateSettingsForSource('userSettings', {
      modelType: arg,
      env: CLEARED_PROVIDER_ENV,
    })
    // Ensure settings.env gets applied to process.env
    applyConfigEnvironmentVariables()
    if (warning) {
      return {
        type: 'text',
        value: `Switched to ${arg} provider.\n${warning}`,
      }
    }
    return { type: 'text', value: `API provider set to ${arg}.` }
  }

  // Cloud providers (bedrock / vertex / foundry): clear all conflicting flags
  // and any persisted non-cloud modelType so env var takes effect, while
  // preserving in-memory API credentials (e.g. OPENAI_API_KEY / OPENAI_BASE_URL).
  clearProcessProviderFlags()
  updateSettingsForSource('userSettings', {
    modelType: undefined,
    env: CLEARED_PROVIDER_ENV,
  })
  applyConfigEnvironmentVariables()
  process.env[getEnvVarForProvider(arg)] = '1'
  return {
    type: 'text',
    value: `API provider set to ${arg} (via environment variable).`,
  }
}

const provider = {
  type: 'local',
  name: 'provider',
  description:
    'Switch API provider (anthropic/openai/gemini/grok/bedrock/vertex/foundry)',
  aliases: ['api'],
  argumentHint: '[anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default provider
