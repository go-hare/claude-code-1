import { spawnSync } from 'child_process'
import {
  expandPastedTextRefs,
  formatPastedTextRef,
  getPastedTextRefNumLines,
} from '../history.js'
import { instances } from '@anthropic/ink'
import type { PastedContent } from './config.js'
import { classifyGuiEditor, getExternalEditor } from './editor.js'
import { getFsImplementation } from './fsOperations.js'
import { toIDEDisplayName } from './ide.js'
import { writeFileSync_DEPRECATED } from './slowOperations.js'
import { generateTempFilePath } from './tempfile.js'

// Map of editor command overrides (e.g., to add wait flags)
const EDITOR_OVERRIDES: Record<string, string> = {
  code: 'code -w', // VS Code: wait for file to be closed
  subl: 'subl --wait', // Sublime Text: wait for file to be closed
}

function isGuiEditor(editor: string): boolean {
  return classifyGuiEditor(editor) !== undefined
}

export type EditorResult = {
  content: string | null
  error?: string
}

// sync IO: called from sync context (React components, sync command handlers)
export function editFileInEditor(filePath: string): EditorResult {
  const fs = getFsImplementation()
  const inkInstance = instances.get(process.stdout)
  if (!inkInstance) {
    throw new Error('Ink instance not found - cannot pause rendering')
  }

  const editor = getExternalEditor()
  if (!editor) {
    return { content: null }
  }

  try {
    fs.statSync(filePath)
  } catch {
    return { content: null }
  }

  // densable Wut: terminal editors → enterAlternateScreen; GUI editors →
  // prepareTerminalForHandoff (pause + disable mouse/focus + suspend stdin)
  // so the host terminal does not emit mouse/focus garbage while the GUI
  // editor owns the window (2.1.216 #16).
  const useAlternateScreen = !isGuiEditor(editor)

  if (useAlternateScreen) {
    // Terminal editors (vi, nano, etc.) take over the terminal. Delegate to
    // Ink's alt-screen-aware handoff so fullscreen mode (where <AlternateScreen>
    // already entered alt screen) doesn't get knocked back to the main buffer
    // by a hardcoded ?1049l. enterAlternateScreen() internally calls pause()
    // and suspendStdin(); exitAlternateScreen() undoes both and resets frame
    // state so the next render writes from scratch.
    inkInstance.enterAlternateScreen()
  } else {
    inkInstance.prepareTerminalForHandoff()
  }

  try {
    // densable Wut: spawnSync argv (not shell) + EDITOR_OVERRIDES for -w/--wait
    const editorCommand = EDITOR_OVERRIDES[editor] ?? editor
    const parts = editorCommand.split(' ')
    const bin = parts[0] ?? editorCommand
    const args = [...parts.slice(1), filePath]
    const result = spawnSync(bin, args, { stdio: 'inherit' })
    const editorName = toIDEDisplayName(editor)

    if (
      result.error ||
      result.signal ||
      (result.status !== null && result.status !== 0)
    ) {
      return {
        content: null,
        error: result.error
          ? `Couldn't open ${editorName} — ${result.error.message}`
          : result.signal
            ? `${editorName} closed unexpectedly (${result.signal})`
            : `${editorName} quit unexpectedly (exit code ${result.status})`,
      }
    }

    // Read the edited content
    const editedContent = fs.readFileSync(filePath, { encoding: 'utf-8' })
    return { content: editedContent }
  } catch {
    return { content: null }
  } finally {
    if (useAlternateScreen) {
      inkInstance.exitAlternateScreen()
    } else {
      inkInstance.restoreTerminalAfterHandoff()
    }
  }
}

/**
 * Re-collapse expanded pasted text by finding content that matches
 * pastedContents and replacing it with references.
 */
function recollapsePastedContent(
  editedPrompt: string,
  _originalPrompt: string,
  pastedContents: Record<number, PastedContent>,
): string {
  let collapsed = editedPrompt

  // Find pasted content in the edited text and re-collapse it
  for (const [id, content] of Object.entries(pastedContents)) {
    if (content.type === 'text') {
      const pasteId = parseInt(id, 10)
      const contentStr = content.content

      // Check if this exact content exists in the edited prompt
      const contentIndex = collapsed.indexOf(contentStr)
      if (contentIndex !== -1) {
        // Replace with reference
        const numLines = getPastedTextRefNumLines(contentStr)
        const ref = formatPastedTextRef(pasteId, numLines)
        collapsed =
          collapsed.slice(0, contentIndex) +
          ref +
          collapsed.slice(contentIndex + contentStr.length)
      }
    }
  }

  return collapsed
}

/** densable sMl — reply fence. Stripped on save (pqw). */
export const EDITOR_REPLY_FENCE =
  '# ─── Write your reply below this line ────────────────────────'

const LAST_RESPONSE_LINE_CAP = 50

/** densable dqw — comment-prefix last response above the reply fence. */
export function wrapLastResponseForEditor(lastResponse: string): string {
  let lines = lastResponse.split('\n')
  if (lines.length > LAST_RESPONSE_LINE_CAP) {
    lines = lines.slice(-LAST_RESPONSE_LINE_CAP)
    lines.unshift('… (earlier output truncated)')
  }
  const body = lines.map(line => (line ? `# ${line}` : '#')).join('\n')
  return (
    `# ─── Claude's last response (for reference; removed on save) ───\n` +
    `${body}\n${EDITOR_REPLY_FENCE}\n\n`
  )
}

/** densable pqw — drop everything through the reply fence. */
export function stripLastResponseFromEditor(edited: string): string {
  const i = edited.indexOf(EDITOR_REPLY_FENCE)
  if (i === -1) return edited
  return edited.slice(i + EDITOR_REPLY_FENCE.length).replace(/^\r?\n\r?\n?/, '')
}

// sync IO: called from sync context (React components, sync command handlers)
export function editPromptInEditor(
  currentPrompt: string,
  pastedContents?: Record<number, PastedContent>,
  lastResponseContext?: string,
): EditorResult {
  const fs = getFsImplementation()
  const tempFile = generateTempFilePath()

  try {
    // Expand any pasted text references before editing
    const expandedPrompt = pastedContents
      ? expandPastedTextRefs(currentPrompt, pastedContents)
      : currentPrompt
    const fileContents = lastResponseContext
      ? wrapLastResponseForEditor(lastResponseContext) + expandedPrompt
      : expandedPrompt

    // Write expanded prompt to temp file
    writeFileSync_DEPRECATED(tempFile, fileContents, {
      encoding: 'utf-8',
      flush: true,
    })

    // Delegate to editFileInEditor
    const result = editFileInEditor(tempFile)

    if (result.content === null) {
      return result
    }

    // Trim a single trailing newline if present (common editor behavior)
    let finalContent = result.content
    if (lastResponseContext) {
      finalContent = stripLastResponseFromEditor(finalContent)
    }
    if (finalContent.endsWith('\n') && !finalContent.endsWith('\n\n')) {
      finalContent = finalContent.slice(0, -1)
    }

    // Re-collapse pasted content if it wasn't edited
    if (pastedContents) {
      finalContent = recollapsePastedContent(
        finalContent,
        currentPrompt,
        pastedContents,
      )
    }

    return { content: finalContent }
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile)
    } catch {
      // Ignore cleanup errors
    }
  }
}
