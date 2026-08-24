import { randomUUID } from 'crypto'
import { basename } from 'path'
import { useEffect, useMemo, useRef, useState } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { readFileSync } from 'src/utils/fileRead.js'
import { expandPath } from 'src/utils/path.js'
import type { PermissionOption } from '../components/permissions/FilePermissionDialog/permissionOptions.js'
import type {
  MCPServerConnection,
  McpSSEIDEServerConfig,
  McpWebSocketIDEServerConfig,
} from '../services/mcp/types.js'
import type { ToolUseContext } from '../Tool.js'
import type { FileEdit } from '@claude-code/builtin-tools/tools/FileEditTool/types.js'
import {
  getEditsForPatch,
  getPatchForEdits,
} from '@claude-code/builtin-tools/tools/FileEditTool/utils.js'
import { getGlobalConfig } from '../utils/config.js'
import { getPatchFromContents } from '../utils/diff.js'
import { isENOENT } from '../utils/errors.js'
import {
  callIdeRpc,
  getConnectedIdeClient,
  getConnectedIdeName,
  hasAccessToIDEExtensionDiffFeature,
} from '../utils/ide.js'
import { WindowsToWSLConverter } from '../utils/idePathConversion.js'
import { logError } from '../utils/log.js'
import { getPlatform } from '../utils/platform.js'

class IdeDiffClosedError extends Error {
  constructor() {
    super('IDE diff closed')
    this.name = 'IdeDiffClosedError'
  }
}

type Props = {
  onChange(
    option: PermissionOption,
    input: {
      file_path: string
      edits: FileEdit[]
    },
  ): void
  toolUseContext: ToolUseContext
  filePath: string
  edits: FileEdit[]
  editMode: 'single' | 'multiple'
}

export function useDiffInIDE({
  onChange,
  toolUseContext,
  filePath,
  edits,
  editMode,
}: Props): {
  closeTabInIDE: () => void
  showingDiffInIDE: boolean
  ideName: string
  hasError: boolean
} {
  const isUnmounted = useRef(false)
  // Per show-session latch: never flip closed back to false on a shared
  // ref — a late previous openDiff would then apply stale updatedInput.
  const sessionRef = useRef<{ closed: boolean; tabName: string }>({
    closed: false,
    tabName: '',
  })
  const [hasError, setHasError] = useState(false)

  const shouldShowDiffInIDE =
    hasAccessToIDEExtensionDiffFeature(toolUseContext.options.mcpClients) &&
    getGlobalConfig().diffTool === 'auto' &&
    // Diffs should only be for file edits.
    // File writes may come through here but are not supported for diffs.
    !filePath.endsWith('.ipynb')

  const ideName =
    getConnectedIdeName(toolUseContext.options.mcpClients) ?? 'IDE'

  async function showDiff(session: {
    closed: boolean
    tabName: string
  }): Promise<void> {
    const sessionTabName = session.tabName
    if (!shouldShowDiffInIDE) {
      return
    }

    try {
      logEvent('tengu_ext_will_show_diff', {})

      const { oldContent, newContent } = await showDiffInIDE(
        filePath,
        edits,
        toolUseContext,
        sessionTabName,
        () => session.closed,
      )
      // Tab already closed / unmounted / permission claimed elsewhere.
      if (isUnmounted.current || session.closed) {
        return
      }

      const newEdits = computeEditsFromContents(
        filePath,
        oldContent,
        newContent,
        editMode,
      )

      if (newEdits.length === 0) {
        // No changes -- edit was rejected (eg. reverted)
        if (session.closed || isUnmounted.current) {
          return
        }
        session.closed = true
        logEvent('tengu_ext_diff_rejected', {})
        // We close the tab here because 'no' no longer auto-closes
        const ideClient = getConnectedIdeClient(
          toolUseContext.options.mcpClients,
        )
        if (ideClient) {
          // Close the tab in the IDE
          await closeTabInIDE(sessionTabName, ideClient)
        }
        onChange(
          { type: 'reject' },
          {
            file_path: filePath,
            edits: edits,
          },
        )
        return
      }

      if (session.closed || isUnmounted.current) {
        return
      }
      session.closed = true
      logEvent('tengu_ext_diff_accepted', {})
      // File was modified - edit was accepted
      onChange(
        { type: 'accept-once' },
        {
          file_path: filePath,
          edits: newEdits,
        },
      )
    } catch (error) {
      if (session.closed || isUnmounted.current) {
        return
      }
      logError(error as Error)
      setHasError(true)
    }
  }

  // densable L4n onReprompt teardown+rebuild: when hook rewrites input,
  // filePath/edits change → close previous tab (`y`) and open a fresh diff
  // so the prior IDE accept cannot answer the new prompt (#24).
  const editsKey = useMemo(() => JSON.stringify(edits), [edits])

  useEffect(() => {
    isUnmounted.current = false
    const session = {
      closed: false,
      tabName: `✻ [Claude Code] ${basename(filePath)} (${randomUUID().slice(0, 6)}) ⧉`,
    }
    sessionRef.current = session
    void showDiff(session)

    return () => {
      isUnmounted.current = true
      session.closed = true
      const ideClient = getConnectedIdeClient(toolUseContext.options.mcpClients)
      if (ideClient && shouldShowDiffInIDE) {
        void closeTabInIDE(session.tabName, ideClient)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, editsKey, editMode])

  return {
    closeTabInIDE() {
      const session = sessionRef.current
      if (session.closed) {
        return Promise.resolve()
      }
      session.closed = true
      const ideClient = getConnectedIdeClient(toolUseContext.options.mcpClients)

      if (!ideClient) {
        return Promise.resolve()
      }

      return closeTabInIDE(session.tabName, ideClient)
    },
    showingDiffInIDE: shouldShowDiffInIDE && !hasError,
    ideName: ideName,
    hasError,
  }
}

/**
 * Re-computes the edits from the old and new contents. This is necessary
 * to apply any edits the user may have made to the new contents.
 */
export function computeEditsFromContents(
  filePath: string,
  oldContent: string,
  newContent: string,
  editMode: 'single' | 'multiple',
): FileEdit[] {
  // Use unformatted patches, otherwise the edits will be formatted.
  const singleHunk = editMode === 'single'
  const patch = getPatchFromContents({
    filePath,
    oldContent,
    newContent,
    singleHunk,
  })

  if (patch.length === 0) {
    return []
  }

  // For single edit mode, verify we only got one hunk
  if (singleHunk && patch.length > 1) {
    logError(
      new Error(
        `Unexpected number of hunks: ${patch.length}. Expected 1 hunk.`,
      ),
    )
  }

  // Re-compute the edits to match the patch
  return getEditsForPatch(patch)
}

/**
 * Done if:
 *
 * 1. Tab is closed in IDE
 * 2. Tab is saved in IDE (we then close the tab)
 * 3. User selected an option in IDE
 * 4. User selected an option in terminal (or hit esc)
 *
 * Resolves with the new file content.
 *
 * TODO: Time out after 5 mins of inactivity?
 * TODO: Update auto-approval UI when IDE exits
 * TODO: Close the IDE tab when the approval prompt is unmounted
 */
async function showDiffInIDE(
  file_path: string,
  edits: FileEdit[],
  toolUseContext: ToolUseContext,
  tabName: string,
  // densable Rrf `o`: () => y — throw/bail when closeTab already ran
  isClosed: () => boolean = () => false,
): Promise<{ oldContent: string; newContent: string }> {
  let isCleanedUp = false

  const oldFilePath = expandPath(file_path)
  let oldContent = ''
  try {
    oldContent = readFileSync(oldFilePath)
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      throw e
    }
  }

  function assertNotClosed(): void {
    if (toolUseContext.abortController.signal.aborted || isClosed()) {
      throw new IdeDiffClosedError()
    }
  }
  assertNotClosed()

  async function cleanup() {
    // Careful to avoid race conditions, since this
    // function can be called from multiple places.
    if (isCleanedUp) {
      return
    }
    isCleanedUp = true

    // Don't fail if this fails
    try {
      await closeTabInIDE(tabName, ideClient)
    } catch (e) {
      logError(e as Error)
    }

    process.off('beforeExit', cleanup)
    toolUseContext.abortController.signal.removeEventListener('abort', cleanup)
  }

  // Cleanup if the user hits esc to cancel the tool call - or on exit
  toolUseContext.abortController.signal.addEventListener('abort', cleanup)
  process.on('beforeExit', cleanup)

  // Open the diff in the IDE
  const ideClient = getConnectedIdeClient(toolUseContext.options.mcpClients)
  try {
    const { updatedFile } = getPatchForEdits({
      filePath: oldFilePath,
      fileContents: oldContent,
      edits,
    })

    if (!ideClient || ideClient.type !== 'connected') {
      throw new Error('IDE client not available')
    }
    let ideOldPath = oldFilePath

    // Only convert paths if we're in WSL and IDE is on Windows
    const ideRunningInWindows =
      (ideClient.config as McpSSEIDEServerConfig | McpWebSocketIDEServerConfig)
        .ideRunningInWindows === true
    if (
      getPlatform() === 'wsl' &&
      ideRunningInWindows &&
      process.env.WSL_DISTRO_NAME
    ) {
      const converter = new WindowsToWSLConverter(process.env.WSL_DISTRO_NAME)
      ideOldPath = converter.toIDEPath(oldFilePath)
      assertNotClosed()
    }

    const rpcResult = await callIdeRpc(
      'openDiff',
      {
        old_file_path: ideOldPath,
        new_file_path: ideOldPath,
        new_file_contents: updatedFile,
        tab_name: tabName,
      },
      ideClient,
    )
    assertNotClosed()

    // Convert the raw RPC result to a ToolCallResponse format
    const data = Array.isArray(rpcResult) ? rpcResult : [rpcResult]

    // If the user saved the file then take the new contents and resolve with that.
    if (isSaveMessage(data)) {
      void cleanup()
      return {
        oldContent: oldContent,
        newContent: data[1].text,
      }
    } else if (isClosedMessage(data)) {
      void cleanup()
      return {
        oldContent: oldContent,
        newContent: updatedFile,
      }
    } else if (isRejectedMessage(data)) {
      void cleanup()
      return {
        oldContent: oldContent,
        newContent: oldContent,
      }
    }

    // Indicates that the tool call completed with none of the expected
    // results. Did the user close the IDE?
    throw new Error('Not accepted')
  } catch (error) {
    if (!(error instanceof IdeDiffClosedError)) {
      logError(error as Error)
    }
    void cleanup()
    throw error
  }
}

async function closeTabInIDE(
  tabName: string,
  ideClient?: MCPServerConnection | undefined,
): Promise<void> {
  try {
    if (!ideClient || ideClient.type !== 'connected') {
      throw new Error('IDE client not available')
    }

    // Use direct RPC to close the tab
    await callIdeRpc('close_tab', { tab_name: tabName }, ideClient)
  } catch (error) {
    logError(error as Error)
    // Don't throw - this is a cleanup operation
  }
}

function isClosedMessage(data: unknown): data is { text: 'TAB_CLOSED' } {
  return (
    Array.isArray(data) &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    'type' in data[0] &&
    data[0].type === 'text' &&
    'text' in data[0] &&
    data[0].text === 'TAB_CLOSED'
  )
}

function isRejectedMessage(data: unknown): data is { text: 'DIFF_REJECTED' } {
  return (
    Array.isArray(data) &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    'type' in data[0] &&
    data[0].type === 'text' &&
    'text' in data[0] &&
    data[0].text === 'DIFF_REJECTED'
  )
}

function isSaveMessage(
  data: unknown,
): data is [{ text: 'FILE_SAVED' }, { text: string }] {
  return (
    Array.isArray(data) &&
    data[0]?.type === 'text' &&
    data[0].text === 'FILE_SAVED' &&
    typeof data[1].text === 'string'
  )
}
