/**
 * densable Artifact tool (2.1.239) — official name `Artifact`.
 *
 * isEnabled: densable `nDa(), ASe()` plus tip cloud-artifacts upload surface.
 * Actions: list | read | comments | reply | resolve | live-edit | tip upload.
 */
import { stat, readFile } from 'fs/promises'
import { z } from 'zod/v4'
import type { ToolResultBlockParam, ToolUseContext } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import {
  isArtifactEnvForceEnabled,
  isArtifactToolDisabled,
} from 'src/utils/artifactGates.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { expandPath, isDeviceOrNtNamespacePath } from 'src/utils/path.js'
import {
  maybeLogArtifactDisabledSession,
  parseArtifactUrl,
  isArtifactToolRegistered,
} from 'src/utils/artifactUrl.js'
import {
  ARTIFACT_TOOL_NAME,
  describeArtifactTool,
  getArtifactToolPrompt,
} from './prompt.js'
import { getArtifactsToken, getUploadUrl } from './config.js'
import { uploadArtifact } from './client.js'
import { markdownToHtml } from './markdown.js'
import { formatArtifactWatchStatus } from 'src/services/artifactAutoReact/watchActions.js'
import { renderToolResultMessage } from './UI.js'
import {
  checkArtifactActionPermissions,
  isArtifactActionConcurrencySafe,
  isArtifactActionReadOnly,
} from './permissions.js'

const uploadInputSchema = z.strictObject({
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
})

const listInputSchema = z.strictObject({
  action: z.literal('list'),
  limit: z.number().int().min(1).max(200).optional(),
  scope: z.enum(['mine', 'shared', 'all']).optional(),
})

const readInputSchema = z.strictObject({
  action: z.literal('read'),
  url: z.string(),
  prompt: z.string().optional(),
})

const commentsInputSchema = z.strictObject({
  action: z.literal('comments'),
  url: z.string(),
  thread_id: z.string().optional(),
})

const replyInputSchema = z.strictObject({
  action: z.literal('reply'),
  url: z.string().describe('Published artifact viewer or frame URL.'),
  thread_id: z.string().describe('Comment thread id to reply on.'),
  text: z.string().describe('Reply text to publish on the thread.'),
  answers_summon: z.boolean().optional(),
  continues_reply_id: z.string().optional(),
})

const resolveInputSchema = z.strictObject({
  action: z.literal('resolve'),
  url: z.string(),
  thread_id: z.string(),
})

const liveEditInputSchema = z.strictObject({
  action: z.literal('live-edit'),
  url: z.string().describe('Published artifact viewer or frame URL.'),
  html: z.string().describe('Full HTML document to publish.'),
})

const watchInputSchema = z.strictObject({
  action: z.literal('watch'),
  url: z.string(),
})

const unwatchInputSchema = z.strictObject({
  action: z.literal('unwatch'),
  url: z.string(),
})

const statusInputSchema = z.strictObject({
  action: z.literal('status'),
  url: z.string().optional(),
})

const listAssetsInputSchema = z.strictObject({
  action: z.literal('list_assets'),
  url: z.string(),
  after: z.string().optional(),
})

const uploadAssetInputSchema = z.strictObject({
  action: z.literal('upload_asset'),
  url: z.string(),
  file_path: z.string(),
})

const deleteAssetInputSchema = z.strictObject({
  action: z.literal('delete_asset'),
  url: z.string(),
  asset_id: z.string(),
})

const listFilesInputSchema = z.strictObject({
  action: z.literal('list_files'),
  url: z.string(),
})

const readFileInputSchema = z.strictObject({
  action: z.literal('read_file'),
  url: z.string(),
  path: z.string().describe('Published path from list_files.'),
  out_dir: z
    .string()
    .optional()
    .describe('Local directory to save into (default: artifact-files/<slug>).'),
  __outDirPin: z
    .object({
      action: z.literal('read_file'),
      slug: z.string(),
      stem: z.string(),
      path: z.string().optional(),
    })
    .optional(),
})

const readAssetInputSchema = z.strictObject({
  action: z.literal('read_asset'),
  url: z.string(),
  asset_id: z.string(),
  out_dir: z
    .string()
    .optional()
    .describe('Local directory; file saved as <asset_id>.<ext>.'),
  __outDirPin: z
    .object({
      action: z.literal('read_asset'),
      slug: z.string(),
      stem: z.string(),
      assetId: z.string().optional(),
    })
    .optional(),
})

const verifyInputSchema = z.strictObject({
  action: z.literal('verify'),
  url: z.string().optional(),
})

const readPageDataInputSchema = z.strictObject({
  action: z.literal('read_page_data'),
  url: z.string(),
  schema: z.string(),
})

const deleteInputSchema = z.strictObject({
  action: z.literal('delete'),
  url: z.string(),
  __deleteConfirm: z
    .object({ slug: z.string() })
    .optional()
    .describe('Permission-pin stamped on user confirm (densable Utn).'),
})

const roomSendInputSchema = z.strictObject({
  action: z.literal('room_send'),
  url: z.string(),
  topic: z.string(),
  data: z.unknown().optional(),
})

const inputSchema = lazySchema(() =>
  z.union([
    uploadInputSchema,
    listInputSchema,
    readInputSchema,
    commentsInputSchema,
    replyInputSchema,
    resolveInputSchema,
    liveEditInputSchema,
    watchInputSchema,
    unwatchInputSchema,
    statusInputSchema,
    listAssetsInputSchema,
    uploadAssetInputSchema,
    deleteAssetInputSchema,
    listFilesInputSchema,
    readFileInputSchema,
    readAssetInputSchema,
    verifyInputSchema,
    readPageDataInputSchema,
    deleteInputSchema,
    roomSendInputSchema,
  ]),
)
type InputSchema = ReturnType<typeof inputSchema>
type ArtifactInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string().default(''),
    url: z.string().default(''),
    expiresAt: z.string().default(''),
    error: z.string().optional(),
    replied: z.boolean().optional(),
    thread_id: z.string().optional(),
    comment_id: z.string().optional(),
    summon_answered: z.boolean().optional(),
    summon_foreign: z.boolean().optional(),
    already_answered: z.boolean().optional(),
    not_activated: z.boolean().optional(),
    published: z.boolean().optional(),
    ver: z.string().optional(),
    artifacts: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          updatedAt: z.string().optional(),
          rel: z.string().optional(),
        }),
      )
      .optional(),
    truncated: z.boolean().optional(),
    scope: z.string().optional(),
    threads: z.array(z.unknown()).optional(),
    threads_dropped: z.boolean().optional(),
    thread_filter: z.string().optional(),
    thread_resolved: z.boolean().optional(),
    not_authorized: z.boolean().optional(),
    read: z
      .object({
        url: z.string(),
        bytes: z.number(),
        code: z.number(),
        codeText: z.string(),
        result: z.string(),
        durationMs: z.number(),
      })
      .optional(),
    watch: z
      .object({
        url: z.string(),
        watching: z.boolean(),
        outcome: z.string(),
        reason: z.string().optional(),
        task_id: z.string().optional(),
        since: z.string().optional(),
        auto_reply: z.boolean().optional(),
        armed_via: z.string().optional(),
      })
      .optional(),
    unwatch: z
      .object({
        url: z.string(),
        was_watching: z.boolean(),
      })
      .optional(),
    watches: z.array(z.unknown()).optional(),
    filter_url: z.string().optional(),
    asset_list: z.unknown().optional(),
    asset_upload: z.unknown().optional(),
    asset_delete: z.unknown().optional(),
    file_list: z.unknown().optional(),
    file_read: z.unknown().optional(),
    asset_read: z.unknown().optional(),
    verify: z.unknown().optional(),
    page_data: z.unknown().optional(),
    artifact_delete: z.unknown().optional(),
    room_send: z.unknown().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ArtifactOutput = z.infer<OutputSchema>

function isUploadInput(
  input: ArtifactInput,
): input is z.infer<typeof uploadInputSchema> {
  return !('action' in input) || input.action === undefined
}

/**
 * Tip upload surface: hardcoded host always applies (`config.ts` defaults).
 * Honor settings.disableArtifact + enableArtifact (unset → ON, old L7t).
 */
function isTipCloudArtifactsUploadOpen(): boolean {
  let settingsDisable: boolean | undefined
  let enable: boolean | undefined
  try {
    const { getInitialSettings, getSettingsForSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/settings/settings.js') as typeof import('src/utils/settings/settings.js')
    const { SETTING_SOURCES } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('src/utils/settings/constants.js') as typeof import('src/utils/settings/constants.js')
    settingsDisable = getInitialSettings().disableArtifact
    for (const source of SETTING_SOURCES) {
      const v = getSettingsForSource(source)?.enableArtifact
      if (v !== undefined) {
        enable = v
        break
      }
    }
  } catch {
    /* settings optional in tests */
  }
  if (isArtifactToolDisabled(process.env, settingsDisable)) return false
  if (isArtifactEnvForceEnabled()) return true
  return enable ?? true
}

let readPageDataSchemaFreezeStarted = false

export const ArtifactTool = buildTool({
  name: ARTIFACT_TOOL_NAME,
  // tip lowercase kept for existing transcripts / cloud upload callers
  aliases: ['artifact'],
  searchHint:
    'artifact list read comments reply resolve live-edit watch unwatch status assets files verify delete room_send upload html markdown share publish',
  briefStandalone: true,
  maxResultSizeChars: 2_000,
  shouldDefer: true,
  strict: true,

  get inputSchema(): InputSchema {
    if (!readPageDataSchemaFreezeStarted) {
      readPageDataSchemaFreezeStarted = true
      void import('src/services/artifactAutoReact/interactionSchemas.js').then(
        m => {
          m.freezeReadPageDataSchemaNames(
            true,
            m.listEnabledInteractionSchemaNames(),
          )
        },
      )
    }
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description(input) {
    if (input && typeof input === 'object' && 'action' in input) {
      switch (input.action) {
        case 'list':
          return 'List Claude artifacts available to this session.'
        case 'read':
          return 'Read a published artifact page.'
        case 'comments':
          return 'Read comment threads on a published artifact.'
        case 'reply':
          return 'Post a reply comment on a thread of a published artifact.'
        case 'resolve':
          return 'Resolve a comment thread on a published artifact.'
        case 'live-edit':
          return 'Apply live edits to an already-published artifact page.'
        case 'watch':
          return 'Watch a published artifact for new comments.'
        case 'unwatch':
          return 'Stop watching a published artifact.'
        case 'status':
          return 'List live and durable artifact watches in this session.'
        case 'list_assets':
          return 'List uploaded assets on a published artifact.'
        case 'upload_asset':
          return 'Upload a binary asset to a published artifact.'
        case 'delete_asset':
          return 'Delete an asset from a published artifact.'
        case 'list_files':
          return 'List files on a published artifact.'
        case 'read_file':
          return 'Download a published artifact file to a local out_dir.'
        case 'read_asset':
          return 'Download an artifact asset blob to a local out_dir.'
        case 'verify':
          return 'Read runtime diagnostics for a published artifact.'
        case 'read_page_data':
          return 'Read structured page-data islands from a published artifact.'
        case 'delete':
          return 'Permanently delete a published artifact.'
        case 'room_send':
          return 'Send a live room event to current artifact viewers.'
      }
    }
    return describeArtifactTool()
  },
  async prompt() {
    return getArtifactToolPrompt()
  },

  /**
   * densable `isEnabled(){ return nDa(), ASe() }`.
   * Tip also opens for cloud-artifacts upload when tip hosting env / force is set.
   */
  isEnabled() {
    maybeLogArtifactDisabledSession()
    if (isArtifactToolRegistered()) return true
    return isTipCloudArtifactsUploadOpen()
  },
  isConcurrencySafe(input) {
    return isArtifactActionConcurrencySafe(input as { action?: string })
  },
  isReadOnly(input) {
    return isArtifactActionReadOnly(input as { action?: string })
  },
  requiresUserInteraction() {
    return true
  },
  userFacingName() {
    return 'Artifact'
  },

  async checkPermissions(input: ArtifactInput, context) {
    if (!isUploadInput(input) && !isArtifactToolRegistered()) {
      return {
        behavior: 'deny' as const,
        message:
          'Official Artifact actions are not available in this build (cobalt registration is closed). Use tip upload without `action` to publish a local HTML/Markdown file.',
        decisionReason: {
          type: 'other' as const,
          reason: 'ASe closed',
        },
      }
    }
    return checkArtifactActionPermissions(
      input as Record<string, unknown>,
      context,
    )
  },

  renderToolUseMessage(input: Partial<ArtifactInput>) {
    if (input && 'action' in input) {
      switch (input.action) {
        case 'list':
          return 'List artifacts'
        case 'read':
          return `Read artifact ${'url' in input ? input.url : '…'}`
        case 'comments':
          return `Comments on ${'url' in input ? input.url : '…'}`
        case 'reply':
          return `Reply on thread ${'thread_id' in input ? input.thread_id : '…'}`
        case 'resolve':
          return `Resolve thread ${'thread_id' in input ? input.thread_id : '…'}`
        case 'live-edit':
          return `Live-edit artifact ${'url' in input ? input.url : '…'}`
        case 'watch':
          return `Watch ${'url' in input ? input.url : '…'}`
        case 'unwatch':
          return `Unwatch ${'url' in input ? input.url : '…'}`
        case 'status':
          return 'Artifact watch status'
        case 'list_assets':
          return `List assets on ${'url' in input ? input.url : '…'}`
        case 'upload_asset':
          return `Upload asset to ${'url' in input ? input.url : '…'}`
        case 'delete_asset':
          return `Delete asset ${'asset_id' in input ? input.asset_id : '…'}`
        case 'list_files':
          return `List files on ${'url' in input ? input.url : '…'}`
        case 'read_file':
          return `Save file ${'path' in input ? input.path : '…'}`
        case 'read_asset':
          return `Save asset ${'asset_id' in input ? input.asset_id : '…'}`
        case 'verify':
          return `Verify ${'url' in input && input.url ? input.url : 'last publish'}`
        case 'read_page_data':
          return `Read page data on ${'url' in input ? input.url : '…'}`
        case 'delete':
          return `Delete ${'url' in input ? input.url : '…'}`
        case 'room_send':
          return `Room send ${'topic' in input ? input.topic : '…'}`
      }
    }
    const hashPart =
      input && 'hash' in input && input.hash ? ` (hash=${input.hash})` : ''
    return `Upload artifact: ${input && 'file_path' in input ? (input.file_path ?? '...') : '...'}${hashPart}`
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
    if (content.artifacts) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Listed ${content.artifacts.length} artifact(s)`,
      }
    }
    if (content.threads) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Read ${content.threads.length} comment thread(s)`,
      }
    }
    if (content.thread_resolved === true) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Resolved thread ${content.thread_id ?? ''}`,
      }
    }
    if (content.thread_resolved === false) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(content),
      }
    }
    if (content.read) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: content.read.result.slice(0, 4000),
      }
    }
    if (content.replied === true) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Reply posted on thread ${content.thread_id ?? ''}${content.comment_id ? ` (${content.comment_id})` : ''}`,
      }
    }
    if (content.replied === false) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(content),
      }
    }
    if (content.published === true) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Artifact live-edit published${content.ver ? ` (ver ${content.ver})` : ''}`,
      }
    }
    if (content.watch) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(content.watch),
      }
    }
    if (content.unwatch) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(content.unwatch),
      }
    }
    if (content.watches) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: formatArtifactWatchStatus({
          watches: content.watches as Parameters<
            typeof formatArtifactWatchStatus
          >[0]['watches'],
          ...(content.filter_url !== undefined
            ? { filter_url: content.filter_url }
            : {}),
        }),
      }
    }
    if (
      content.asset_list ||
      content.asset_upload ||
      content.asset_delete ||
      content.file_list ||
      content.file_read ||
      content.asset_read ||
      content.verify ||
      content.page_data ||
      content.artifact_delete ||
      content.room_send
    ) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(content),
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Artifact uploaded: ${content.url} (id: ${content.id}, expires: ${content.expiresAt})`,
    }
  },
  renderToolResultMessage,

  async call(
    input: ArtifactInput,
    context?: Partial<ToolUseContext>,
    _canUseTool?,
    _parentMessage?,
  ) {
    void _canUseTool
    void _parentMessage
    const signal = context?.abortController?.signal
    if (!isUploadInput(input)) {
      if (!isArtifactToolRegistered()) {
        return {
          data: {
            id: '',
            url: '',
            expiresAt: '',
            error:
              'Official Artifact actions are not available in this build (cobalt registration is closed). Use tip upload without `action` to publish a local HTML/Markdown file.',
          },
        }
      }
      switch (input.action) {
        case 'list':
          return callList(input, signal)
        case 'read':
          return callRead(input, signal)
        case 'comments':
          return callComments(input, signal, context)
        case 'reply':
          return callReply(input, signal)
        case 'resolve':
          return callResolve(input, signal)
        case 'live-edit': {
          const { getArtifactLiveEditVf } = await import(
            'src/services/artifactAutoReact/liveEditPermissions.js'
          )
          const vf = getArtifactLiveEditVf()
          if (!vf) {
            return {
              data: {
                id: '',
                url: '',
                expiresAt: '',
                error: 'live-edit is not available in this build',
              },
            }
          }
          if (vf.runLiveEditAction) {
            return vf.runLiveEditAction(input, signal)
          }
          return callLiveEdit(input, signal)
        }
        case 'watch':
          return callWatch(input, context)
        case 'unwatch':
          return callUnwatch(input, context)
        case 'status':
          return callStatus(input)
        case 'list_assets':
          return callListAssets(input, signal)
        case 'upload_asset':
          return callUploadAsset(input, signal)
        case 'delete_asset':
          return callDeleteAsset(input, signal)
        case 'list_files':
          return callListFiles(input, signal)
        case 'read_file':
          return callReadFile(input, signal)
        case 'read_asset':
          return callReadAsset(input, signal)
        case 'verify':
          return callVerify(input, signal)
        case 'read_page_data':
          return callReadPageData(input, signal)
        case 'delete':
          return callDelete(input, signal)
        case 'room_send':
          return callRoomSend(input)
      }
    }
    return callUpload(input as z.infer<typeof uploadInputSchema>)
  },
})

type WtTaskRegistry = {
  all: () => Record<
    string,
    {
      type?: string
      status?: string
      frameLive?: { slug?: string }
      id?: string
    }
  >
  update?: (
    id: string,
    fn: (t: Record<string, unknown>) => Record<string, unknown>,
  ) => void
}

function emptyErr(error: string): { data: ArtifactOutput } {
  return { data: { id: '', url: '', expiresAt: '', error } }
}

async function callWatch(
  input: z.infer<typeof watchInputSchema>,
  context?: Partial<ToolUseContext>,
): Promise<{ data: ArtifactOutput }> {
  const { callArtifactWatch } = await import(
    'src/services/artifactAutoReact/watchActions.js'
  )
  const abort = context?.abortController ?? new AbortController()
  const setAppState =
    context?.setAppState ??
    ((f: (prev: unknown) => unknown) => {
      void f({})
    })
  const taskRegistry = (
    context as { taskRegistry?: WtTaskRegistry } | undefined
  )?.taskRegistry
  const r = await callArtifactWatch({
    url: input.url,
    context: {
      abortController: abort,
      ...(taskRegistry ? { taskRegistry } : {}),
    },
    setAppState: setAppState as import('src/Task.js').SetAppState,
    signal: abort.signal,
    toolUseId: context?.toolUseId,
  })
  if ('error' in r) return emptyErr(r.error)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      watch: r.data.watch,
    },
  }
}

async function callUnwatch(
  input: z.infer<typeof unwatchInputSchema>,
  context?: Partial<ToolUseContext>,
): Promise<{ data: ArtifactOutput }> {
  const { callArtifactUnwatch } = await import(
    'src/services/artifactAutoReact/watchActions.js'
  )
  const abort = context?.abortController ?? new AbortController()
  const taskRegistry = (
    context as { taskRegistry?: WtTaskRegistry } | undefined
  )?.taskRegistry
  const r = await callArtifactUnwatch({
    url: input.url,
    context: {
      abortController: abort,
      ...(taskRegistry ? { taskRegistry } : {}),
    },
  })
  if ('error' in r) return emptyErr(r.error)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      unwatch: r.data.unwatch,
    },
  }
}

async function callStatus(
  input: z.infer<typeof statusInputSchema>,
): Promise<{ data: ArtifactOutput }> {
  const { callArtifactStatus } = await import(
    'src/services/artifactAutoReact/watchActions.js'
  )
  const r = await callArtifactStatus({ url: input.url })
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      watches: r.data.watches,
      ...(r.data.filter_url !== undefined
        ? { filter_url: r.data.filter_url }
        : {}),
    },
  }
}

async function callListAssets(
  input: z.infer<typeof listAssetsInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "list_assets"')
  }
  const { listArtifactAssets } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const { artifactViewerUrlFor } = await import('src/utils/artifactUrl.js')
  const r = await listArtifactAssets({
    slug: parsed.slug,
    after: input.after,
    signal,
  })
  if (r.kind === 'error') return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      asset_list: {
        url: artifactViewerUrlFor(parsed),
        assets: r.assets.map(a => ({
          id: a.id,
          url: a.url,
          content_type: a.contentType,
          size_bytes: a.sizeBytes,
          ...(a.sha256 !== undefined ? { sha256: a.sha256 } : {}),
          created_at: a.createdAt,
        })),
        usage: {
          files: r.usage.files,
          bytes: r.usage.bytes,
          max_files: r.usage.maxFiles,
          max_bytes: r.usage.maxBytes,
        },
        ...(r.next !== undefined ? { next: r.next } : {}),
      },
    },
  }
}

async function callUploadAsset(
  input: z.infer<typeof uploadAssetInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "upload_asset"')
  }
  const { uploadArtifactAsset } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const r = await uploadArtifactAsset({
    slug: parsed.slug,
    filePath: expandPath(input.file_path),
    signal,
  })
  if (r.kind === 'error') return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      asset_upload: {
        id: r.asset.id,
        url: r.asset.url,
        size_bytes: r.asset.sizeBytes,
        content_type: r.asset.contentType,
        ...(r.asset.sha256 !== undefined ? { sha256: r.asset.sha256 } : {}),
        file_name: r.fileName,
      },
    },
  }
}

async function callDeleteAsset(
  input: z.infer<typeof deleteAssetInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "delete_asset"')
  }
  const { deleteArtifactAsset } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const r = await deleteArtifactAsset({
    slug: parsed.slug,
    id: input.asset_id,
    signal,
  })
  if (r.kind === 'error') return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      asset_delete: { id: input.asset_id, deleted: r.deleted },
    },
  }
}

async function callListFiles(
  input: z.infer<typeof listFilesInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "list_files"')
  }
  const { listArtifactFiles } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const { artifactViewerUrlFor } = await import('src/utils/artifactUrl.js')
  const r = await listArtifactFiles({ slug: parsed.slug, signal })
  if (r.kind === 'error') return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      file_list: {
        url: artifactViewerUrlFor(parsed),
        ver: r.ver,
        files: r.files.map(f => ({
          path: f.path,
          content_type: f.contentType,
          size_bytes: f.sizeBytes,
          sha256: f.sha256,
        })),
        ...(r.cowritten ? { cowritten: true } : {}),
      },
    },
  }
}

async function callReadFile(
  input: z.infer<typeof readFileInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const { callArtifactReadFile } = await import(
    'src/services/artifactAutoReact/saveActions.js'
  )
  const r = await callArtifactReadFile({
    url: input.url,
    path: input.path,
    out_dir: input.out_dir,
    pin: input.__outDirPin,
    signal,
  })
  if ('error' in r) return emptyErr(r.error)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      file_read: r.data.file_read,
    },
  }
}

async function callReadAsset(
  input: z.infer<typeof readAssetInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const { callArtifactReadAsset } = await import(
    'src/services/artifactAutoReact/saveActions.js'
  )
  const r = await callArtifactReadAsset({
    url: input.url,
    asset_id: input.asset_id,
    out_dir: input.out_dir,
    pin: input.__outDirPin,
    signal,
  })
  if ('error' in r) return emptyErr(r.error)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      asset_read: r.data.asset_read,
    },
  }
}

async function callVerify(
  input: z.infer<typeof verifyInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const { isArtifactVerifyGateOpen, fetchArtifactVerifyDiagnostics } =
    await import('src/services/artifactAutoReact/restApis.js')
  if (!isArtifactVerifyGateOpen()) {
    return emptyErr('verify is not available in this session.')
  }
  if (typeof input.url !== 'string') {
    return emptyErr(
      "Nothing to verify: pass the artifact url, or publish first. Without `url`, verify targets this session's most recent publish.",
    )
  }
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "verify"')
  }
  const { artifactViewerUrlFor } = await import('src/utils/artifactUrl.js')
  const r = await fetchArtifactVerifyDiagnostics({
    slug: parsed.slug,
    signal,
  })
  if (r.kind === 'error') return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      verify: {
        url: artifactViewerUrlFor(parsed),
        ver: r.ver,
        state: r.state,
        entries: r.entries,
        ...(r.truncated ? { truncated: true } : {}),
        ...(r.dropped !== undefined ? { dropped: r.dropped } : {}),
      },
    },
  }
}

async function callReadPageData(
  input: z.infer<typeof readPageDataInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const { runReadPageData } = await import(
    'src/services/artifactAutoReact/readPageData.js'
  )
  const r = await runReadPageData({
    url: input.url,
    schema: input.schema,
    signal,
  })
  if (!r.ok) return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: r.page_data.url,
      expiresAt: '',
      page_data: r.page_data,
    },
  }
}

async function callDelete(
  input: z.infer<typeof deleteInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "delete"')
  }
  const pin = input.__deleteConfirm
  if (!pin || pin.slug !== parsed.slug) {
    return emptyErr(
      'This delete was not confirmed by the user, so nothing was deleted; retry so the confirmation is shown.',
    )
  }
  const { deleteArtifactFrame } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const { artifactViewerUrlFor } = await import('src/utils/artifactUrl.js')
  const r = await deleteArtifactFrame({ slug: parsed.slug, signal })
  if (r.kind === 'error') return emptyErr(r.message)
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      artifact_delete: {
        url: artifactViewerUrlFor(parsed),
        deleted: true,
        ...(r.alreadyGone ? { already_gone: true } : {}),
      },
    },
  }
}

async function callRoomSend(
  input: z.infer<typeof roomSendInputSchema>,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return emptyErr('`url` must be an artifact URL for action "room_send"')
  }
  const { sendArtifactRoomEvent } = await import(
    'src/services/artifactAutoReact/restApis.js'
  )
  const { artifactViewerUrlFor } = await import('src/utils/artifactUrl.js')
  const r = sendArtifactRoomEvent(parsed.slug, input.topic, input.data)
  if (!r.ok && (r.reason === 'invalid_topic' || r.reason === 'invalid_data')) {
    return emptyErr(
      `room_send refused after permission or hook rewrites: ${r.reason}`,
    )
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      room_send: {
        url: artifactViewerUrlFor(parsed),
        topic: input.topic,
        delivered: r.ok,
        ...(r.ok ? { peers: r.peers } : { reason: r.reason }),
      },
    },
  }
}

async function callList(
  input: z.infer<typeof listInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const { listArtifactFrames } = await import(
    'src/services/artifactAutoReact/listFrames.js'
  )
  const r = await listArtifactFrames({
    limit: input.limit,
    scope: input.scope,
    signal,
  })
  if (r.err !== null) {
    return { data: { id: '', url: '', expiresAt: '', error: r.err } }
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      artifacts: r.rows,
      ...(r.truncated ? { truncated: true } : {}),
      ...(input.scope && input.scope !== 'mine' ? { scope: input.scope } : {}),
    },
  }
}

async function callRead(
  input: z.infer<typeof readInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const started = Date.now()
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error: '`url` must be an artifact URL for action "read"',
      },
    }
  }
  const { readArtifactHtml } = await import(
    'src/services/artifactAutoReact/edit.js'
  )
  const r = await readArtifactHtml(
    parsed.slug,
    signal ?? new AbortController().signal,
    parsed.env,
  )
  if (!r.html) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error:
          'editable' in r && r.editable === false
            ? (r.reason ?? 'read failed')
            : 'read failed',
      },
    }
  }
  const result = r.html
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      read: {
        url: input.url,
        bytes: Buffer.byteLength(result),
        code: 200,
        codeText: 'OK',
        result,
        durationMs: Date.now() - started,
      },
    },
  }
}

async function callComments(
  input: z.infer<typeof commentsInputSchema>,
  signal?: AbortSignal,
  context?: Partial<ToolUseContext>,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error: '`url` must be an artifact URL for action "comments"',
      },
    }
  }
  const { readArtifactComments } = await import(
    'src/services/artifactAutoReact/commentRead.js'
  )
  const r = await readArtifactComments(
    parsed.slug,
    signal ?? new AbortController().signal,
    { env: parsed.env },
  )
  if (r.err !== null) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error: r.err,
      },
    }
  }
  let threads = r.threads
  if (input.thread_id) {
    threads = threads.filter(t => t.id === input.thread_id)
    if (threads.length === 0) {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          error: `no comment thread ${input.thread_id} on this artifact`,
        },
      }
    }
  }
  // densable: lTm only when agentId is unset and not gb(agentContext).
  // Local has no delegatedObservation (gb); skip on subagent agentId only.
  if (context?.agentId === undefined) {
    const { markCommentsReadForCensus } = await import(
      'src/services/artifactAutoReact/commentCensus.js'
    )
    markCommentsReadForCensus(
      parsed.slug,
      threads,
      r.threads,
      r.threadsDropped === true,
    )
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      threads,
      ...(input.thread_id ? { thread_filter: input.thread_id } : {}),
      ...(r.threadsDropped ? { threads_dropped: true } : {}),
    },
  }
}

async function callResolve(
  input: z.infer<typeof resolveInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error: 'url and thread_id are required for action "resolve"',
      },
    }
  }
  const { resolveArtifactCommentThread } = await import(
    'src/services/artifactAutoReact/commentResolve.js'
  )
  const r = await resolveArtifactCommentThread({
    slug: parsed.slug,
    threadId: input.thread_id,
    signal,
  })
  if (r.kind === 'ok') {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        thread_resolved: true,
        thread_id: input.thread_id,
      },
    }
  }
  if (r.kind === 'not_activated') {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        thread_resolved: false,
        thread_id: input.thread_id,
        not_activated: true,
      },
    }
  }
  if (r.kind === 'not_authorized') {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        thread_resolved: false,
        thread_id: input.thread_id,
        not_authorized: true,
      },
    }
  }
  if (r.kind === 'summon_foreign') {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        thread_resolved: false,
        thread_id: input.thread_id,
        summon_foreign: true,
      },
    }
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      thread_resolved: false,
      thread_id: input.thread_id,
      error: r.message,
    },
  }
}

async function callReply(
  input: z.infer<typeof replyInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  const slug = parsed?.slug
  if (!slug) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        replied: false,
        error: 'url is not a recognized artifact address',
      },
    }
  }
  const { postArtifactCommentReply } = await import(
    'src/services/artifactAutoReact/commentReply.js'
  )
  const posted = await postArtifactCommentReply({
    slug,
    threadId: input.thread_id,
    text: input.text,
    signal,
    answersSummon: input.answers_summon === true,
    continuesReplyId: input.continues_reply_id,
  })
  if (posted.kind !== 'ok') {
    const msg = posted.message
    if (msg.includes('not_activated') || msg.includes('403')) {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          replied: false,
          thread_id: input.thread_id,
          not_activated: true,
        },
      }
    }
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        replied: false,
        thread_id: input.thread_id,
        error: msg,
      },
    }
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      replied: true,
      thread_id: input.thread_id,
      ...(posted.commentId !== undefined
        ? { comment_id: posted.commentId }
        : {}),
    },
  }
}

async function callLiveEdit(
  input: z.infer<typeof liveEditInputSchema>,
  signal?: AbortSignal,
): Promise<{ data: ArtifactOutput }> {
  const parsed = parseArtifactUrl(input.url)
  const slug = parsed?.slug
  if (!slug) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        published: false,
        error: 'url is not a recognized artifact address',
      },
    }
  }
  const { publishArtifactHtml } = await import(
    'src/services/artifactAutoReact/edit.js'
  )
  const r = await publishArtifactHtml({
    slug,
    html: input.html,
    signal: signal ?? new AbortController().signal,
  })
  if (!r.ok) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        published: false,
        error: r.message,
      },
    }
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      published: true,
      ...(r.ver !== undefined ? { ver: r.ver } : {}),
    },
  }
}

async function callUpload(
  input: z.infer<typeof uploadInputSchema>,
): Promise<{ data: ArtifactOutput }> {
  const { file_path, hash, ttl } = input

  const expanded = expandPath(file_path)
  if (
    isDeviceOrNtNamespacePath(expanded) ||
    isDeviceOrNtNamespacePath(file_path)
  ) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error:
          'file_path: device- or NT-namespace paths cannot be published — spell the path plainly',
      },
    }
  }

  let size: number
  try {
    const fileStat = await stat(expanded)
    if (!fileStat.isFile()) {
      return {
        data: {
          id: '',
          url: '',
          expiresAt: '',
          error: `Path is not a regular file: ${expanded}`,
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
        error: `File does not exist or is not readable: ${expanded}`,
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
    rawContent = await readFile(expanded, 'utf8')
  } catch {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        error: `Failed to read file: ${expanded}`,
      },
    }
  }

  const lowerPath = expanded.toLowerCase()
  let html: string
  if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
    html = rawContent
  } else if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
    html = markdownToHtml(rawContent, expanded)
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

  try {
    const result = await uploadArtifact({
      html,
      token: getArtifactsToken(),
      uploadUrl: getUploadUrl(),
      hash,
      ttl,
    })
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
}
