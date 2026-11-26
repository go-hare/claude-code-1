import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { checkGcpCredentialsValid } from '../../utils/auth.js'

export type VertexAuthMethod = 'adc' | 'serviceAccount' | 'environment'

export type VertexWizardData = {
  authMethod: VertexAuthMethod
  projectId: string
  region: string
  keyFile?: string
  pinSonnet?: string
  pinOpus?: string
  pinHaiku?: string
  pinFable?: string
  verifiedIdentity?: string
}

export type VertexVerifyOk = {
  status: 'ok'
  identity: string
  note?: string
}

export type VertexVerifyError = {
  status: 'error'
  error: string
  command?: string
}

export type VertexVerifyResult = VertexVerifyOk | VertexVerifyError

export function expandHomePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/**
 * Discover GCP project IDs from `~/.config/gcloud/configurations/config_*`
 * (official `vertex_wizard.js` project step).
 */
export function discoverGcloudProjects(
  configRoot: string = join(
    process.env.CLOUDSDK_CONFIG || join(homedir(), '.config', 'gcloud'),
    'configurations',
  ),
): string[] {
  const found = new Set<string>()
  const envProject =
    process.env.ANTHROPIC_VERTEX_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim()
  if (envProject) found.add(envProject)

  try {
    if (!existsSync(configRoot)) return [...found]
    const entries = readdirSync(configRoot).filter(name =>
      name.startsWith('config_'),
    )
    for (const entry of entries) {
      try {
        const text = readFileSync(join(configRoot, entry), 'utf8')
        const match = /^\s*project\s*=\s*(\S+)/m.exec(text)
        if (match?.[1]) {
          found.add(match[1].trim())
        }
      } catch {
        // skip unreadable config file
      }
    }
  } catch {
    // gcloud dir optional
  }

  return [...found]
}

/**
 * Verify Vertex AI wizard credentials (service account JSON, ADC, or env).
 */
export async function verifyVertexWizardCredentials(
  data: VertexWizardData,
): Promise<VertexVerifyResult> {
  if (!data.projectId.trim()) {
    return {
      status: 'error',
      error: 'GCP project ID is required.',
    }
  }
  if (!data.region.trim()) {
    return {
      status: 'error',
      error:
        'Vertex AI region is required (for example: global, us, eu, us-east5).',
    }
  }

  if (data.authMethod === 'serviceAccount') {
    const keyPath = expandHomePath(data.keyFile ?? '')
    if (!keyPath || !existsSync(keyPath)) {
      return {
        status: 'error',
        error: `Service account key file not found: ${keyPath || '(empty)'}`,
      }
    }
    try {
      const parsed = JSON.parse(readFileSync(keyPath, 'utf8')) as {
        client_email?: unknown
        type?: unknown
        private_key?: unknown
      }
      if (
        typeof parsed.client_email !== 'string' ||
        typeof parsed.private_key !== 'string'
      ) {
        return {
          status: 'error',
          error:
            'Key file does not look like a GCP service account JSON key (missing client_email or private_key).',
        }
      }
      return {
        status: 'ok',
        identity: parsed.client_email,
        note: `Service account key verified (${data.projectId} · ${data.region})`,
      }
    } catch (err) {
      return {
        status: 'error',
        error: `Could not parse service account key file: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  if (data.authMethod === 'adc') {
    const valid = await checkGcpCredentialsValid()
    if (!valid) {
      return {
        status: 'error',
        error:
          'Application Default Credentials were not found or have expired.',
        command: 'gcloud auth application-default login',
      }
    }
    return {
      status: 'ok',
      identity: `ADC (${data.projectId})`,
      note: `Google Cloud ADC active (${data.region})`,
    }
  }

  // 'environment'
  const credsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credsFile && existsSync(credsFile)) {
    return {
      status: 'ok',
      identity: credsFile,
      note: `Using GOOGLE_APPLICATION_CREDENTIALS (${data.projectId} · ${data.region})`,
    }
  }
  const valid = await checkGcpCredentialsValid()
  if (valid) {
    return {
      status: 'ok',
      identity: `Environment credentials (${data.projectId})`,
      note: `Vertex AI region: ${data.region}`,
    }
  }
  return {
    status: 'ok',
    identity: `Environment (${data.projectId})`,
    note: 'Using credentials already configured in your environment.',
  }
}

/**
 * Official 2.1.331 `pe(t)` — build `userSettings.env` patch for Vertex AI.
 * Clears conflicting provider flags and writes Vertex AI keys + optional model pins.
 */
export function buildVertexSettingsEnv(
  data: VertexWizardData,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
    CLAUDE_CODE_USE_ANTHROPIC_AWS: undefined,
    CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD: undefined,
    CLAUDE_CODE_USE_MANTLE: undefined,
    CLAUDE_CODE_USE_OPENAI: undefined,
    CLAUDE_CODE_USE_GEMINI: undefined,
    CLAUDE_CODE_USE_GROK: undefined,
    ANTHROPIC_VERTEX_PROJECT_ID: data.projectId.trim(),
    CLOUD_ML_REGION: data.region.trim() || 'global',
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined,
    ANTHROPIC_DEFAULT_FABLE_MODEL: undefined,
    ANTHROPIC_SMALL_FAST_MODEL: undefined,
  }
  if (data.authMethod === 'serviceAccount' && data.keyFile) {
    env.GOOGLE_APPLICATION_CREDENTIALS = expandHomePath(data.keyFile)
  }
  if (data.pinSonnet?.trim()) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = data.pinSonnet.trim()
  }
  if (data.pinOpus?.trim()) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = data.pinOpus.trim()
  }
  if (data.pinFable?.trim()) {
    env.ANTHROPIC_DEFAULT_FABLE_MODEL = data.pinFable.trim()
  }
  if (data.pinHaiku?.trim()) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = data.pinHaiku.trim()
  }
  return env
}
