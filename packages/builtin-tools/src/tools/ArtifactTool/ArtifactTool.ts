import { stat, readFile } from 'fs/promises'
import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { isArtifactToolDisabled } from 'src/utils/artifactGates.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  ARTIFACT_TOOL_NAME,
  describeArtifactTool,
  getArtifactToolPrompt,
} from './prompt.js'
import { getArtifactsToken, getUploadUrl } from './config.js'
import { uploadArtifact } from './client.js'
import { markdownToHtml } from './markdown.js'
import { renderToolResultMessage } from './UI.js'
import { sanitizeArtifactHtmlForPublishAsync } from 'src/utils/chartRuntimeSanitize.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe(
        'Absolute path to a local HTML (.html/.htm) or Markdown (.md/.markdown) file to upload. Markdown is converted to styled HTML before upload.',
      ),
    hash: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/, 'must match ^[A-Za-z0-9_-]{1,128}$')
      .optional()
      .describe(
        'If provided, overwrites the existing artifact with this hash (URL stays stable). If omitted, a new random id is generated.',
      ),
    ttl: z
      .union([z.literal(7), z.literal(30)])
      .default(7)
      .describe('Lifetime in days. Must be 7 or 30. Default 7.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type ArtifactInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    url: z.string(),
    expiresAt: z.string(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ArtifactOutput = z.infer<OutputSchema>

export const ArtifactTool = buildTool({
  name: ARTIFACT_TOOL_NAME,
  searchHint:
    'upload html markdown artifact share url cloud publish progress report public link',
  maxResultSizeChars: 2_000,
  shouldDefer: true,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description() {
    return describeArtifactTool()
  },
  async prompt() {
    return getArtifactToolPrompt()
  },

  isEnabled() {
    // Official R9i/P7t densable — disableArtifact env/settings wins; else
    // CLAUDE_CODE_ARTIFACT force-on, then enableArtifact sources, default true.
    try {
      const { getInitialSettings, getSettingsForSource } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/settings/settings.js') as typeof import('src/utils/settings/settings.js')
      const { SETTING_SOURCES } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/settings/constants.js') as typeof import('src/utils/settings/constants.js')
      const { resolveEnableArtifactFromSources } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/residualFinalEnvGates.js') as typeof import('src/utils/residualFinalEnvGates.js')
      const { isArtifactEnvForceEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/artifactGates.js') as typeof import('src/utils/artifactGates.js')
      const settings = getInitialSettings()
      if (isArtifactToolDisabled(process.env, settings.disableArtifact)) {
        return false
      }
      // Official CLAUDE_CODE_ARTIFACT force-enable densable.
      if (isArtifactEnvForceEnabled()) {
        return true
      }
      const enable = resolveEnableArtifactFromSources(
        SETTING_SOURCES.map(s => getSettingsForSource(s)?.enableArtifact),
      )
      // Official L7t default true when enableArtifact unset.
      return enable ?? true
    } catch {
      try {
        const { isArtifactEnvForceEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('src/utils/artifactGates.js') as typeof import('src/utils/artifactGates.js')
        if (isArtifactEnvForceEnabled()) return true
      } catch {
        // densable optional
      }
      return !isArtifactToolDisabled()
    }
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  // densable residual — steer common model mistakes (inline content / long label).
  validationErrorSteer(input) {
    if (typeof input !== 'object' || input === null) return null
    const raw = input as Record<string, unknown>
    if ('content' in raw) {
      return (
        'The Artifact tool reads from a file on disk — it does not take inline `content`. ' +
        'Write the page to an .html or .md file first (Write/Edit), then call Artifact with ' +
        '`file_path` pointing at it (a `title` parameter is used only when the file lacks its own <title> tag).'
      )
    }
    if (
      'label' in raw &&
      typeof raw.label === 'string' &&
      raw.label.length > 60
    ) {
      return '`label` is a short version name (max 60 chars). Move longer text into the page content.'
    }
    return null
  },
  requiresUserInteraction() {
    return true
  },
  userFacingName() {
    return 'Artifact'
  },

  renderToolUseMessage(input: Partial<ArtifactInput>) {
    const hashPart = input.hash ? ` (hash=${input.hash})` : ''
    return `Upload artifact: ${input.file_path ?? '...'}${hashPart}`
  },

  mapToolResultToToolResultBlockParam(
    content: ArtifactOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    if (content.error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        is_error: true,
        content: content.error,
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Artifact uploaded: ${content.url} (id: ${content.id}, expires: ${content.expiresAt})`,
    }
  },
  renderToolResultMessage,

  async call(input: ArtifactInput) {
    const { file_path, hash, ttl } = input

    let size: number
    try {
      const fileStat = await stat(file_path)
      if (!fileStat.isFile()) {
        return {
          data: {
            id: '',
            url: '',
            expiresAt: '',
            error: `Path is not a regular file: ${file_path}`,
          },
        }
      }
      size = fileStat.size
    } catch {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          error: `File does not exist or is not readable: ${file_path}`,
        },
      }
    }

    if (size > 10 * 1024 * 1024) {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          error: `File is ${size} bytes; backend limit is 10MB.`,
        },
      }
    }

    let rawContent: string
    try {
      rawContent = await readFile(file_path, 'utf8')
    } catch {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          error: `Failed to read file: ${file_path}`,
        },
      }
    }

    const lowerPath = file_path.toLowerCase()
    let html: string
    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
      html = rawContent
    } else if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
      html = markdownToHtml(rawContent, file_path)
    } else {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          error: `Unsupported file extension. Accepted: .html, .htm, .md, .markdown — got: ${file_path}`,
        },
      }
    }

    // densable F9u: strip prior chart-runtime regions; try inject trusted
    // Chart.umd + v8g boot when data-chart-runtime present and pewter allows.
    // Bundle is optional (bunfs / vendor path); missing bundle still publishes
    // stripped HTML (densable We chart_bundle_unreadable residual soft).
    try {
      const { readFile: rf } = await import('fs/promises')
      const sanitized = await sanitizeArtifactHtmlForPublishAsync(html, {
        readFile: (p, enc) => rf(p, enc),
        cwd: process.cwd(),
      })
      html = sanitized.body
    } catch {
      // fall through with original html if sanitize import/IO path fails
    }

    try {
      const result = await uploadArtifact({
        html,
        token: getArtifactsToken(),
        uploadUrl: getUploadUrl(),
        hash,
        ttl,
      })
      // Official CLAUDE_CODE_ARTIFACT_AUTO_OPEN densable — open after success.
      try {
        const { isArtifactAutoOpenEnabled } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('src/utils/artifactGates.js') as typeof import('src/utils/artifactGates.js')
        if (isArtifactAutoOpenEnabled() && result.url) {
          const { openBrowser } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('src/utils/browser.js') as typeof import('src/utils/browser.js')
          void openBrowser(result.url)
        }
      } catch {
        // densable optional
      }
      return { data: result }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { data: { id: '', url: '', expiresAt: '', error: message } }
    }
  },
})
