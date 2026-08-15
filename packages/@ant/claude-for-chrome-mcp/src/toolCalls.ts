import { constants as fsConstants } from 'fs'
import {
  open as openAsync,
  lstat as lstatAsync,
  realpath as realpathAsync,
} from 'fs/promises'
import { basename, extname, resolve as pathResolve } from 'path'

import type { CallToolResult } from '@modelcontextprotocol/server'
import { BRIDGE_ONLY_BROWSER_TOOLS } from './browserTools.js'
import { SocketConnectionError } from './mcpSocketClient.js'
import type {
  ChromeExtensionInfo,
  ClaudeForChromeContext,
  PermissionMode,
  PermissionOverrides,
  SocketClient,
} from './types.js'
import { toLoggerDetail } from './types.js'

/** densable Fps — combined file_upload size cap (10 MB). */
const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export const handleToolCall = async (
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
  name: string,
  args: Record<string, unknown>,
  permissionOverrides?: PermissionOverrides,
): Promise<CallToolResult> => {
  // Handle permission mode changes locally (not forwarded to extension)
  if (name === 'set_permission_mode') {
    return handleSetPermissionMode(socketClient, args)
  }

  // Handle switch_browser outside the normal tool call flow (manages its own connection)
  if (name === 'switch_browser') {
    return handleSwitchBrowser(context, socketClient)
  }

  // densable: multi-browser tools are local bridge ops
  if (name === 'list_connected_browsers') {
    return handleListConnectedBrowsers(context, socketClient)
  }
  if (name === 'select_browser') {
    return handleSelectBrowser(context, socketClient, args)
  }

  // densable Biy: expand file_upload paths → base64 files (standalone or in batch);
  // always reject bridge-only tools inside browser_batch (those are top-level only).
  let callArgs = args
  try {
    const prepared = await prepareToolArgsForChrome(name, args)
    if ('error' in prepared) {
      return {
        content: [{ type: 'text', text: prepared.error }],
        isError: true,
      }
    }
    callArgs = prepared.input
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error preparing tool args: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }

  try {
    const isConnected = await socketClient.ensureConnected()

    context.logger.silly(
      `[${context.serverName}] Server is connected: ${isConnected}. Received tool call: ${name} with args: ${JSON.stringify(sanitizeArgsForLog(callArgs))}.`,
    )

    if (isConnected) {
      return await handleToolCallConnected(
        context,
        socketClient,
        name,
        callArgs,
        permissionOverrides,
      )
    }

    return handleToolCallDisconnected(context)
  } catch (error) {
    context.logger.info(
      `[${context.serverName}] Error calling tool:`,
      toLoggerDetail(error),
    )

    if (error instanceof SocketConnectionError) {
      return handleToolCallDisconnected(context)
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error calling tool, please try again. : ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

/** Avoid logging base64 file payloads (top-level or nested in browser_batch). */
function sanitizeFilesForLog(files: unknown): unknown {
  if (typeof files === 'string') {
    return `[redacted string ${files.length} chars]`
  }
  if (!Array.isArray(files)) {
    return files
  }
  return files.map((f: unknown) => {
    if (typeof f === 'string') {
      return `[redacted string ${f.length} chars]`
    }
    if (typeof f === 'object' && f !== null && 'data' in f) {
      const file = f as { data?: string; name?: string; mimeType?: string }
      return {
        name: file.name,
        mimeType: file.mimeType,
        data: `[base64 ${file.data?.length ?? 0} chars]`,
      }
    }
    return f
  })
}

/** Exported for unit tests — redacts file payloads from tool-call debug logs. */
export function sanitizeArgsForLog(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!('files' in args) && !('actions' in args)) {
    return args
  }
  const out: Record<string, unknown> = { ...args }
  if ('files' in out) {
    out.files = sanitizeFilesForLog(out.files)
  }
  if (Array.isArray(out.actions)) {
    out.actions = out.actions.map((action: unknown) => {
      if (typeof action !== 'object' || action === null) {
        return action
      }
      const a = action as { name?: string; input?: Record<string, unknown> }
      if (
        typeof a.input === 'object' &&
        a.input !== null &&
        'files' in a.input
      ) {
        return {
          ...a,
          input: {
            ...a.input,
            files: sanitizeFilesForLog(a.input.files),
          },
        }
      }
      return action
    })
  }
  return out
}

/**
 * densable Biy/Ned: rewrite file_upload paths into bridge `files` payloads;
 * expand nested file_upload inside browser_batch; never allow bridge-only tools
 * inside batch (switch/list/select are top-level local handlers only).
 * Exported for unit tests.
 */
export async function prepareToolArgsForChrome(
  name: string,
  args: Record<string, unknown>,
): Promise<{ input: Record<string, unknown> } | { error: string }> {
  // Fork: models often call tabs_context_mcp with no args, then tabs_create_mcp
  // fails with "No MCP tab group exists". densable leaves createIfEmpty optional
  // (extension default false). When omitted, default true so the first context
  // call bootstraps a group. Explicit false still means "read only / no create".
  if (name === 'tabs_context_mcp' && !('createIfEmpty' in args)) {
    return { input: { ...args, createIfEmpty: true } }
  }

  const budget = { remaining: FILE_UPLOAD_MAX_BYTES }
  if (name === 'file_upload') {
    return expandFileUploadArgs(args, budget)
  }
  if (name === 'browser_batch') {
    if (!Array.isArray(args.actions)) {
      return { error: 'browser_batch requires an `actions` array.' }
    }
    const actions = [...args.actions]
    let rewritten = false
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]
      if (
        typeof action !== 'object' ||
        action === null ||
        typeof (action as { name?: unknown }).name !== 'string'
      ) {
        return {
          error:
            'browser_batch sub-actions must be objects with a string name, and browser_batch cannot be nested.',
        }
      }
      const actionName = (action as { name: string }).name
      if (!/^[\x20-\x7E]+$/.test(actionName)) {
        return {
          error: `browser_batch sub-action name "${actionName}" is not a valid tool name.`,
        }
      }
      const normalized = actionName.trim().toLowerCase()
      if (normalized === 'browser_batch') {
        return {
          error:
            'browser_batch sub-actions must be objects with a string name, and browser_batch cannot be nested.',
        }
      }
      if (normalized === 'file_upload' && actionName !== 'file_upload') {
        return {
          error: `browser_batch sub-action name "${actionName}" is not a valid tool name.`,
        }
      }
      // Top-level only: local pairing/list/select handlers — never batch/forward.
      if (BRIDGE_ONLY_BROWSER_TOOLS.has(normalized)) {
        return {
          error: `browser_batch cannot include "${actionName}" (switch_browser / list_connected_browsers / select_browser are top-level only, not batchable).`,
        }
      }
      if (actionName !== 'file_upload') {
        continue
      }
      const input =
        typeof (action as { input?: unknown }).input === 'object' &&
        (action as { input: unknown }).input !== null
          ? (action as { input: Record<string, unknown> }).input
          : {}
      const expanded = await expandFileUploadArgs(input, budget)
      if ('error' in expanded) {
        return { error: expanded.error }
      }
      actions[i] = { ...(action as object), input: expanded.input }
      rewritten = true
    }
    return rewritten ? { input: { ...args, actions } } : { input: args }
  }
  return { input: args }
}

async function expandFileUploadArgs(
  args: Record<string, unknown>,
  budget: { remaining: number },
): Promise<{ input: Record<string, unknown> } | { error: string }> {
  // Host densable Biy rewrites paths → files with full Uiy. Trust only
  // Host-shaped payloads (files present, no paths). Combined size budget still
  // enforced. Bare `paths` still expand here for standalone MCP / tests — that
  // path does NOT apply session allowlist (Host intercept is the policy gate).
  if (
    !('paths' in args) &&
    Array.isArray(args.files) &&
    args.files.length > 0
  ) {
    for (const entry of args.files) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { data?: unknown }).data !== 'string'
      ) {
        return {
          error:
            'file_upload `files` entries must include base64 `data` strings.',
        }
      }
      const data = (entry as { data: string }).data
      // base64 → approx decoded length
      const approx = Math.floor((data.length * 3) / 4)
      if (approx > budget.remaining) {
        return {
          error: `Cannot upload: total upload size would exceed ${Math.round(FILE_UPLOAD_MAX_BYTES / 1048576)} MB. file_upload sends file contents over the browser bridge in a single message; use a smaller file, or split across multiple file_upload calls if the page accepts files one at a time.`,
        }
      }
      budget.remaining -= approx
    }
    return { input: args }
  }

  const paths = args.paths
  if (!Array.isArray(paths) || paths.length === 0) {
    return {
      error:
        'file_upload requires a non-empty `paths` array of files the user has shared with this session (Host expands under session allowlist). Do not pass only pre-encoded `files` without Host prep.',
    }
  }
  const files: Array<{ data: string; name: string; mimeType: string }> = []
  for (const entry of paths) {
    if (typeof entry !== 'string') {
      return { error: 'file_upload `paths` entries must be strings.' }
    }
    const loaded = await readFileForUpload(entry, budget)
    if ('error' in loaded) {
      return { error: loaded.error }
    }
    files.push(loaded.file)
  }
  const { paths: _paths, ...rest } = args
  return { input: { ...rest, files } }
}

function fileUploadMissingMessage(path: string): string {
  return `Cannot upload "${path}": path does not resolve to an existing regular file (check the absolute path, or copy hard-linked package files out of node_modules first).`
}

async function readFileForUpload(
  originalPath: string,
  budget: { remaining: number },
): Promise<
  { file: { data: string; name: string; mimeType: string } } | { error: string }
> {
  const absolute = pathResolve(originalPath)
  let real: string
  try {
    real = await realpathAsync(absolute)
  } catch {
    return { error: fileUploadMissingMessage(originalPath) }
  }

  let st
  try {
    st = await lstatAsync(real)
  } catch {
    return { error: `Cannot upload "${originalPath}": not a regular file.` }
  }
  if (!st.isFile()) {
    return { error: `Cannot upload "${originalPath}": not a regular file.` }
  }
  if (st.nlink > 1) {
    return {
      error: `Cannot upload "${originalPath}": the file has multiple hard links (common for package-manager stores like node_modules with Bun/pnpm). Copy the file (e.g. with cp) and upload the copy instead.`,
    }
  }
  if (st.size > budget.remaining) {
    return {
      error: `Cannot upload "${originalPath}": total upload size would exceed ${Math.round(FILE_UPLOAD_MAX_BYTES / 1048576)} MB. file_upload sends file contents over the browser bridge in a single message; use a smaller file, or split across multiple file_upload calls if the page accepts files one at a time.`,
    }
  }

  let buf: Buffer
  try {
    // densable Fed: O_RDONLY | O_NOFOLLOW when available (not on all Windows builds)
    const openFlags =
      fsConstants.O_RDONLY |
      (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    const handle = await openAsync(real, openFlags)
    try {
      const stat2 = await handle.stat()
      if (!stat2.isFile() || stat2.size > budget.remaining) {
        return {
          error: `Cannot upload "${originalPath}": file grew during read or is not a regular file.`,
        }
      }
      buf = Buffer.alloc(stat2.size)
      let offset = 0
      while (offset < stat2.size) {
        const { bytesRead } = await handle.read(
          buf,
          offset,
          stat2.size - offset,
          offset,
        )
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset > budget.remaining) {
        return {
          error: `Cannot upload "${originalPath}": file grew during read.`,
        }
      }
      buf = buf.subarray(0, offset)
    } finally {
      await handle.close()
    }
  } catch (error) {
    return {
      error: `Cannot upload "${originalPath}": failed to read file (${error instanceof Error ? error.message : String(error)}).`,
    }
  }

  budget.remaining -= buf.length
  return {
    file: {
      data: buf.toString('base64'),
      name: basename(real),
      mimeType:
        MIME_BY_EXT[extname(real).toLowerCase()] ?? 'application/octet-stream',
    },
  }
}

function displayNameForExtension(
  ext: ChromeExtensionInfo & { isLocal?: boolean; name?: string },
  index: number,
): string {
  if (ext.name && ext.name.trim()) {
    return ext.name
  }
  const platform = ext.osPlatform ? ` (${ext.osPlatform})` : ''
  const local = ext.isLocal ? ' local' : ''
  return `Browser ${index + 1}${local}${platform}`
}

async function handleListConnectedBrowsers(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
): Promise<CallToolResult> {
  // Bridge: cloud peers. Native: local socket(s) / multi-profile pool.
  // No OAuth required when listConnectedExtensions is implemented on the client.
  if (!socketClient.listConnectedExtensions) {
    return {
      content: [
        {
          type: 'text',
          text: 'Listing browsers is not supported by this Chrome transport.',
        },
      ],
      isError: true,
    }
  }
  if (!(await socketClient.ensureConnected())) {
    return handleToolCallDisconnected(context)
  }
  const extensions = await socketClient.listConnectedExtensions()
  const listed = extensions.map((ext, index) => ({
    ...ext,
    name: displayNameForExtension(ext, index),
  }))
  const content: Array<{ type: 'text'; text: string }> = [
    { type: 'text', text: JSON.stringify(listed) },
  ]
  if (extensions.length > 1) {
    content.push({
      type: 'text',
      text: `${extensions.length} browsers are connected. Use select_browser with a deviceId, or switch_browser to pick another.`,
    })
  } else if (extensions.length === 0) {
    content.push({
      type: 'text',
      text: 'No browsers connected. Open Chrome with the Claude extension (native host) or connect via bridge.',
    })
  }
  return { content }
}

async function handleSelectBrowser(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const deviceId = typeof args.deviceId === 'string' ? args.deviceId : ''
  if (
    !socketClient.selectExtensionById ||
    !socketClient.listConnectedExtensions ||
    !deviceId
  ) {
    return {
      content: [
        {
          type: 'text',
          text: 'select_browser requires a deviceId argument (from list_connected_browsers).',
        },
      ],
      isError: true,
    }
  }
  if (!(await socketClient.ensureConnected())) {
    return handleToolCallDisconnected(context)
  }
  const extensions = await socketClient.listConnectedExtensions()
  const match = extensions.find(ext => ext.deviceId === deviceId)
  if (!match) {
    return {
      content: [
        {
          type: 'text',
          text: `No connected browser has deviceId "${deviceId}". Call list_connected_browsers to see currently connected browsers.`,
        },
      ],
      isError: true,
    }
  }
  const name = displayNameForExtension(match, extensions.indexOf(match))
  socketClient.selectExtensionById(deviceId, name)
  return {
    content: [{ type: 'text', text: `Connected to browser "${name}".` }],
  }
}

async function handleToolCallConnected(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
  name: string,
  args: Record<string, unknown>,
  permissionOverrides?: PermissionOverrides,
): Promise<CallToolResult> {
  const response = await socketClient.callTool(name, args, permissionOverrides)

  context.logger.silly(
    `[${context.serverName}] Received result from socket bridge: ${JSON.stringify(response)}`,
  )

  if (response === null || response === undefined) {
    return {
      content: [{ type: 'text', text: 'Tool execution completed' }],
    }
  }

  // Response will have either result or error field
  const { result, error } = response as {
    result?: { content: unknown[] | string }
    error?: { content: unknown[] | string }
  }

  // Determine which field has the content and whether it's an error
  const contentData = error || result
  const isError = !!error

  if (!contentData) {
    return {
      content: [{ type: 'text', text: 'Tool execution completed' }],
    }
  }

  if (isError && isAuthenticationError(contentData.content)) {
    context.onAuthenticationError()
  }

  const { content } = contentData

  if (content && Array.isArray(content)) {
    if (isError) {
      return {
        content: content.map((item: unknown) => {
          if (typeof item === 'object' && item !== null && 'type' in item) {
            return item
          }

          return { type: 'text', text: String(item) }
        }),
        isError: true,
      } as CallToolResult
    }

    const convertedContent = content.map((item: unknown) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        'source' in item
      ) {
        const typedItem = item
        if (
          typedItem.type === 'image' &&
          typeof typedItem.source === 'object' &&
          typedItem.source !== null &&
          'data' in typedItem.source
        ) {
          return {
            type: 'image',
            data: typedItem.source.data,
            mimeType:
              'media_type' in typedItem.source
                ? typedItem.source.media_type || 'image/png'
                : 'image/png',
          }
        }
      }

      if (typeof item === 'object' && item !== null && 'type' in item) {
        return item
      }

      return { type: 'text', text: String(item) }
    })

    return {
      content: convertedContent,
      isError,
    } as CallToolResult
  }

  // Handle string content
  if (typeof content === 'string') {
    return {
      content: [{ type: 'text', text: content }],
      isError,
    } as CallToolResult
  }

  // Fallback for unexpected result format
  context.logger.warn(
    `[${context.serverName}] Unexpected result format from socket bridge: ${JSON.stringify(response)}`,
  )

  return {
    content: [{ type: 'text', text: JSON.stringify(response) }],
    isError,
  }
}

function handleToolCallDisconnected(
  context: ClaudeForChromeContext,
): CallToolResult {
  const text = context.onToolCallDisconnected()
  // Mark isError so the model does not treat the densable disconnect blurb as a
  // successful "account checklist" answer and stop retrying with createIfEmpty.
  return {
    content: [{ type: 'text', text }],
    isError: true,
  }
}

/**
 * Handle set_permission_mode tool call locally.
 * This is security-sensitive as it controls whether permission prompts are shown.
 */
async function handleSetPermissionMode(
  socketClient: SocketClient,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  // Validate permission mode at runtime
  const validModes = [
    'ask',
    'skip_all_permission_checks',
    'follow_a_plan',
  ] as const
  const mode = args.mode as string | undefined
  const permissionMode: PermissionMode =
    mode && validModes.includes(mode as PermissionMode)
      ? (mode as PermissionMode)
      : 'ask'

  if (socketClient.setPermissionMode) {
    await socketClient.setPermissionMode(
      permissionMode,
      args.allowed_domains as string[] | undefined,
    )
  }

  return {
    content: [
      { type: 'text', text: `Permission mode set to: ${permissionMode}` },
    ],
  }
}

/**
 * Handle switch_browser tool call. Broadcasts a pairing request and blocks
 * until a browser responds or timeout.
 */
async function handleSwitchBrowser(
  context: ClaudeForChromeContext,
  socketClient: SocketClient,
): Promise<CallToolResult> {
  // Bridge: broadcast pairing. Native: cycle among connected local sockets.
  if (!socketClient.switchBrowser) {
    return {
      content: [
        {
          type: 'text',
          text: 'Browser switching is not supported by this Chrome transport.',
        },
      ],
      isError: true,
    }
  }

  const isConnected = await socketClient.ensureConnected()
  if (!isConnected) {
    return handleToolCallDisconnected(context)
  }

  const result = (await socketClient.switchBrowser()) ?? null

  if (result === 'no_other_browsers') {
    return {
      content: [
        {
          type: 'text',
          text: 'No other browsers available to switch to. Open another Chrome profile with the Claude extension, or use list_connected_browsers.',
        },
      ],
      isError: true,
    }
  }

  if (result) {
    return {
      content: [
        { type: 'text', text: `Connected to browser "${result.name}".` },
      ],
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: context.bridgeConfig
          ? 'No browser responded within the timeout. Make sure Chrome is open with the Claude extension installed, then try again.'
          : 'Could not switch browser. Call list_connected_browsers and select_browser with a deviceId.',
      },
    ],
    isError: true,
  }
}

/**
 * Check if the error content indicates an authentication issue
 */
function isAuthenticationError(content: unknown[] | string): boolean {
  const errorText = Array.isArray(content)
    ? content
        .map(item => {
          if (typeof item === 'string') return item
          if (
            typeof item === 'object' &&
            item !== null &&
            'text' in item &&
            typeof item.text === 'string'
          ) {
            return item.text
          }
          return ''
        })
        .join(' ')
    : String(content)

  return errorText.toLowerCase().includes('re-authenticated')
}
