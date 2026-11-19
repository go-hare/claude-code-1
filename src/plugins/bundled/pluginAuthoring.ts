/**
 * densable 2.1.289 `cc-plugin-plugin-authoring` — yfe + uS({skills:[f]}).
 * Skill BODY stays goldOfficialMissingSkills; this is the /plugin listing.
 * v2.1.300 #806: registers `scan_secrets` MCP tool (`mcp__plugin-authoring__scan_secrets`).
 */
import { createHash } from 'crypto'
import { constants as fsConstants } from 'fs'
import { lstat, open, readdir, stat } from 'fs/promises'
import { basename, isAbsolute, join, resolve } from 'path'
import { z } from 'zod/v4'
import {
  createSdkMcpServer,
  tool,
} from '../../entrypoints/sdk/createSdkMcpServer.js'
import { leftoverHooksModulesOn } from '../../utils/plugins/pluginDevMods.js'
import { createPluginAuthoringSkill } from '../../skills/bundled/goldOfficialMissingSkills.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const PLUGIN_AUTHORING_PLUGIN_NAME = 'cc-plugin-plugin-authoring'
export const PLUGIN_AUTHORING_PLUGIN_DESCRIPTION =
  'Plugin authoring: Claude knows how a plugin of function hooks is written, typed and debugged against this build'

export const SCAN_SECRETS_TOOL_NAME = 'scan_secrets'
export const SCAN_SECRETS_MCP_SERVER_NAME = 'plugin-authoring'
export const SCAN_SECRETS_FULL_TOOL_NAME = `mcp__${SCAN_SECRETS_MCP_SERVER_NAME}__${SCAN_SECRETS_TOOL_NAME}`
export const SCAN_SECRETS_MAX_FILE_BYTES = 10 * 1024 * 1024
export const SCAN_SECRETS_MAX_TOTAL_BYTES = 25 * 1024 * 1024
export const SCAN_SECRETS_MAX_ENTRIES = 20_000
export const SCAN_SECRETS_MAX_FINDINGS = 100
export const SCAN_SECRETS_MAX_SKIPPED = 30
const REDACTED_SECRET_NAME = '<name holding a secret>'
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'

export type PluginAuthoringComplianceOff = 'tainted' | 'pending' | undefined

export const SKILL_PROMPT_COMPLIANCE_REASONS: Record<
  Exclude<PluginAuthoringComplianceOff, undefined>,
  string
> = {
  tainted: "your organization's compliance settings turn it off.",
  pending:
    "your organization's policy has not loaded, and the scan cannot run until it does; once it has, loading the skill again adds the tool.",
}

export const TOOL_CALL_COMPLIANCE_REASONS: Record<
  Exclude<PluginAuthoringComplianceOff, undefined>,
  string
> = {
  tainted: "your organization's compliance settings turn the scan off.",
  pending:
    "your organization's policy has not loaded, and the scan cannot run until it does.",
}

export type ComplianceHostLike = {
  complianceTaints: readonly string[]
  hintedTaints: readonly string[]
  verdict?: { complianceTaintsSettled: () => boolean } | null
}

/**
 * Upstream v2.1.304 `ce()` — checks if compliance taints (hipaa/zdr) or
 * unsettled organization policy (`pending`) disable the secret scan.
 */
export function getPluginAuthoringComplianceOff(
  hostOverride?: ComplianceHostLike,
): PluginAuthoringComplianceOff {
  try {
    const host =
      hostOverride ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (
        require('../../cli/leftoverTulip.js') as typeof import('../../cli/leftoverTulip.js')
      ).leftoverPolicyLimitsHost()
    if (
      host.complianceTaints.includes('hipaa') ||
      host.complianceTaints.includes('zdr') ||
      host.hintedTaints.includes('hipaa') ||
      host.hintedTaints.includes('zdr')
    ) {
      return 'tainted'
    }
    const settled = host.verdict?.complianceTaintsSettled()
    if (settled === false) {
      return 'pending'
    }
    return undefined
  } catch {
    return undefined
  }
}

const SECRET_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'Anthropic Key',
    pattern: /(?:^|[^A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{40,}/,
  },
  {
    label: 'AWS Access Key ID',
    pattern: /(?:^|[^A-Z0-9])(AKIA|ASIA)[A-Z0-9]{16}(?:[^A-Z0-9]|$)/,
  },
  {
    label: 'GitHub Token',
    pattern: /(?:^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{36,}/,
  },
  {
    label: 'OpenAI Key',
    pattern: /(?:^|[^A-Za-z0-9_-])sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/,
  },
  {
    label: 'Slack Token',
    pattern: /(?:^|[^A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    label: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
]

export type SecretScanFinding = {
  path: string
  kinds: string[]
}

export type SecretScanSkipped = {
  path: string
  reason: string
}

export type SecretScanResult = {
  text: string
  isError: boolean
  scannedCount?: number
  findings?: SecretScanFinding[]
  notScanned?: SecretScanSkipped[]
  capped?: boolean
}

function detectSecretKinds(text: string): string[] {
  const kinds: string[] = []
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text) && !kinds.includes(label)) {
      kinds.push(label)
    }
  }
  return kinds
}

function redactSecretFilename(relPath: string): string {
  const parts = relPath.split(/([\\/])/)
  return parts
    .map(part =>
      part !== '/' && part !== '\\' && detectSecretKinds(part).length > 0
        ? REDACTED_SECRET_NAME
        : part,
    )
    .join('')
}

/**
 * #806: Scans the files in a mod's folder for known key and token formats.
 * Reads only; runs no git and reads nothing in `.git`.
 */
export async function scanModSecretsFolder(
  folder: string,
): Promise<SecretScanResult> {
  if (typeof folder !== 'string' || folder.trim() === '') {
    const msg =
      "Result: the scan could not run: no folder was given; the scan takes the mod's folder, as an absolute path, in its folder argument."
    return { text: `${msg}\n${msg}`, isError: true }
  }
  if (!isAbsolute(folder)) {
    const msg =
      'Result: the scan could not run: the folder must be an absolute path.'
    return { text: `${msg}\n${msg}`, isError: true }
  }

  const resolved = resolve(folder)
  if (resolved.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) {
    const msg =
      'Result: the scan could not run: the folder is a .git folder or inside one, which the scan does not read'
    return { text: `${msg}\n${msg}`, isError: true }
  }

  let rootLstat
  try {
    rootLstat = await lstat(resolved)
  } catch {
    const msg = 'Result: the scan could not run: no such folder'
    return { text: `${msg}\n${msg}`, isError: true }
  }
  if (rootLstat.isSymbolicLink()) {
    const msg =
      'Result: the scan could not run: the folder is a link, not the folder it leads to'
    return { text: `${msg}\n${msg}`, isError: true }
  }
  if (!rootLstat.isDirectory()) {
    const msg = 'Result: the scan could not run: not a folder'
    return { text: `${msg}\n${msg}`, isError: true }
  }

  const queue: string[] = ['']
  const files: Array<{ rel: string; size: number }> = []
  const notScanned: SecretScanSkipped[] = []
  let entryCount = 0
  let capped = false

  while (queue.length > 0) {
    const relDir = queue.shift()!
    const absDir = relDir === '' ? resolved : join(resolved, relDir)
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      notScanned.push({ path: relDir || '.', reason: 'unreadable' })
      continue
    }
    for (const entry of entries) {
      if (entry.name.toLowerCase() === '.git') continue
      entryCount += 1
      if (entryCount > SCAN_SECRETS_MAX_ENTRIES) {
        capped = true
        break
      }
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      const abs = join(resolved, rel)
      if (entry.isSymbolicLink()) {
        notScanned.push({ path: rel, reason: 'link' })
        continue
      }
      let st
      try {
        st = await lstat(abs)
      } catch {
        notScanned.push({ path: rel, reason: 'unreadable' })
        continue
      }
      if (st.isSymbolicLink()) {
        notScanned.push({ path: rel, reason: 'link' })
      } else if (st.isDirectory()) {
        queue.push(rel)
      } else if (st.isFile()) {
        if (st.nlink > 1) {
          notScanned.push({ path: rel, reason: 'hard link' })
        } else {
          files.push({ rel, size: st.size })
        }
      } else {
        notScanned.push({ path: rel, reason: 'not a plain file' })
      }
    }
    if (capped) break
  }

  files.sort((a, b) => a.size - b.size || a.rel.localeCompare(b.rel))
  let totalBytes = 0
  let scannedCount = 0
  const findings: SecretScanFinding[] = []

  for (const file of files) {
    if (file.size > SCAN_SECRETS_MAX_FILE_BYTES) {
      notScanned.push({ path: file.rel, reason: 'too large' })
      continue
    }
    if (totalBytes + file.size > SCAN_SECRETS_MAX_TOTAL_BYTES) {
      notScanned.push({ path: file.rel, reason: 'total limit' })
      continue
    }
    totalBytes += file.size
    let content: string | undefined
    try {
      const handle = await open(join(resolved, file.rel), 'r')
      try {
        const st = await handle.stat()
        if (!st.isFile()) {
          notScanned.push({ path: file.rel, reason: 'not a plain file' })
          continue
        }
        const buf = Buffer.alloc(
          Math.min(file.size, SCAN_SECRETS_MAX_FILE_BYTES),
        )
        let offset = 0
        while (offset < buf.length) {
          const { bytesRead } = await handle.read(
            buf,
            offset,
            buf.length - offset,
            offset,
          )
          if (bytesRead === 0) break
          offset += bytesRead
        }
        content = buf.subarray(0, offset).toString('utf8')
      } finally {
        await handle.close().catch(() => undefined)
      }
    } catch {
      // fallback via stat check
      await stat(join(resolved, file.rel)).catch(() => undefined)
      notScanned.push({ path: file.rel, reason: 'unreadable' })
      continue
    }

    if (content.startsWith(LFS_POINTER_PREFIX)) {
      notScanned.push({ path: file.rel, reason: 'lfs pointer' })
      continue
    }
    scannedCount += 1
    const kinds = new Set<string>([
      ...detectSecretKinds(content),
      ...detectSecretKinds(file.rel),
    ])
    if (kinds.size > 0) {
      findings.push({
        path: redactSecretFilename(file.rel),
        kinds: [...kinds],
      })
    }
  }

  const resultLine =
    findings.length === 0
      ? `Result: scanned ${scannedCount} file(s); no possible secrets found.`
      : `Result: scanned ${scannedCount} file(s); found ${findings.length} file(s) with possible secrets.`
  const lines: string[] = [resultLine]
  if (findings.length > 0) {
    lines.push('Possible secrets:')
    for (const f of findings.slice(0, SCAN_SECRETS_MAX_FINDINGS)) {
      lines.push(`- ${f.path}: ${f.kinds.join(', ')}`)
    }
    if (findings.length > SCAN_SECRETS_MAX_FINDINGS) {
      lines.push(
        `... and ${findings.length - SCAN_SECRETS_MAX_FINDINGS} more file(s) with possible secrets.`,
      )
    }
  }
  if (notScanned.length > 0) {
    lines.push('Not scanned:')
    for (const s of notScanned.slice(0, SCAN_SECRETS_MAX_SKIPPED)) {
      lines.push(`- ${s.path}: ${s.reason}`)
    }
    if (notScanned.length > SCAN_SECRETS_MAX_SKIPPED) {
      lines.push(
        `... and ${notScanned.length - SCAN_SECRETS_MAX_SKIPPED} more skipped item(s).`,
      )
    }
  }
  if (capped) {
    lines.push(
      `Note: folder was too large to look at in full (stopped after ${SCAN_SECRETS_MAX_ENTRIES} entries).`,
    )
  }
  lines.push(resultLine)

  return {
    text: lines.join('\n'),
    isError: false,
    scannedCount,
    findings,
    notScanned,
    capped,
  }
}

export function createPluginAuthoringMcpServer() {
  const scanSecretsTool = tool(
    SCAN_SECRETS_TOOL_NAME,
    "Scans the files in a mod's folder, before the mod is shared, for known key and token formats, reading them as they are on disk now (it runs no git and reads nothing in .git). Starts and ends its answer with a Result: line. Names the files with a possible secret and the kind of secret, never the value (up to 100; the rest are counted), and the files and folders it did not scan and why (up to 30; the rest are counted), and says where the folder was too large to look at in full; a file name that holds a secret is shown as <name holding a secret>. Reads only; changes nothing.",
    {
      folder: z
        .string()
        .describe(
          "The mod's folder, as an absolute path: the top folder of its git repository",
        ),
    },
    async ({ folder }) => {
      const complianceOff = getPluginAuthoringComplianceOff()
      if (complianceOff !== undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Result: the scan could not run: ${TOOL_CALL_COMPLIANCE_REASONS[complianceOff]}`,
            },
          ],
          isError: true,
        }
      }
      const res = await scanModSecretsFolder(folder)
      return {
        content: [{ type: 'text' as const, text: res.text }],
        ...(res.isError ? { isError: true } : {}),
      }
    },
  )

  return createSdkMcpServer({
    name: SCAN_SECRETS_MCP_SERVER_NAME,
    tools: [scanSecretsTool],
  })
}

export function isPluginAuthoringPluginAvailable(): boolean {
  return leftoverHooksModulesOn()
}

// ---------------------------------------------------------------------------
// #2190 (v2.1.323): Pre-send secret key check for plugin files in claude.ai
// chats and Cowork tasks.
// ---------------------------------------------------------------------------

export const PLUGIN_HANDOVER_CHECK_SOURCE = 'plugin_authoring_hand_over_check'
const PLUGIN_EXTENSION = '.plugin'
const PLUGIN_ARCHIVE_NAME_RE = /\.(?:plugin|zip)$/i
const PLUGIN_MANIFEST_ENTRY_RE = /(?:^|[\\/])\.claude-plugin(?:[\\/]|$)/i
const ZIP_LOCAL_FILE_MAGIC = 'PK\x03\x04'
const PLUGIN_HANDOVER_EOCD_SCAN_BYTES = 65_557
const PLUGIN_HANDOVER_MAX_CD_BYTES = 8_388_608
const PLUGIN_HANDOVER_MAX_SHOWN_ITEMS = 5
const PLUGIN_HANDOVER_SHOWN_NAME_MAX = 80
const PLUGIN_HANDOVER_TYPED_MAX = 200
const PLUGIN_HANDOVER_REFUSAL_PREFIX = 'Nothing in this call was sent: '
const PLUGIN_HANDOVER_REFERENCE =
  "the plugin-authoring skill's reference.md, Packaging a mod in a chat"
const PLUGIN_HANDOVER_CHECK_FAILED_MSG = `${PLUGIN_HANDOVER_REFUSAL_PREFIX}the check for secret keys that runs before a plugin file or a zip is handed over did not finish. Try the call once more; if it fails again, tell the person the file could not be checked and was not sent.`

export type PluginHandoverFileIdentity = {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}

export type PluginHandoverRecorded = {
  case: string
  count: number
}

export type PluginHandoverBasis = 'no_zip_start' | { digest: string }

export type PluginHandoverInspectResult =
  | {
      kind: 'other'
      seen?: PluginHandoverFileIdentity
      basis?: PluginHandoverBasis
    }
  | {
      kind: 'clean'
      seen: PluginHandoverFileIdentity
      basis?: PluginHandoverBasis
    }
  | { kind: 'refused'; refusal: string }
  | {
      kind: 'ask'
      seen: PluginHandoverFileIdentity
      basis?: PluginHandoverBasis
      isPlugin: boolean
      recorded: PluginHandoverRecorded
      found: string
      question: string
    }

export type PluginHandoverAskChoice = {
  value: 'hold' | 'send'
  label: string
  description: string
}

export type PluginHandoverAskRequest = {
  source: typeof PLUGIN_HANDOVER_CHECK_SOURCE
  header: string
  question: string
  choices: readonly PluginHandoverAskChoice[]
  personOnly: true
}

export type PluginHandoverAskAnswer =
  | { kind: 'chose'; value: 'hold' | 'send' }
  | { kind: 'declined'; typedAnswer?: string }
  | { kind: 'aborted' }
  | { kind: 'unanswered'; reason: string }

export type PluginHandoverAskFn = (
  request: PluginHandoverAskRequest,
  signal?: AbortSignal,
) => Promise<PluginHandoverAskAnswer | undefined>

export function isPluginAuthoringChatSession(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork' ||
    env.CLAUDE_CODE_SESSION_ORIGIN === 'claude_ai_chat' ||
    env.CLAUDE_CODE_IS_COWORK === '1'
  )
}

export function snapshotFileIdentity(st: {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}): PluginHandoverFileIdentity {
  return {
    dev: st.dev,
    ino: st.ino,
    size: st.size,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs,
  }
}

export function compareFileIdentity(
  a: PluginHandoverFileIdentity | undefined,
  b: PluginHandoverFileIdentity | undefined,
): 'presence' | 'dev' | 'size' | 'ino_and_times' | 'times' | 'ino' | undefined {
  if (a === undefined || b === undefined) {
    return a === b ? undefined : 'presence'
  }
  if (a.dev !== b.dev) return 'dev'
  if (a.size !== b.size) return 'size'
  const inoChanged = a.ino !== b.ino
  if (a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs) {
    return inoChanged ? 'ino_and_times' : 'times'
  }
  return inoChanged ? 'ino' : undefined
}

function truncateDisplayLabel(label: string, maxLen: number): string {
  const clean = label.replace(/[\r\n\t]+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  return `${clean.slice(0, Math.max(1, maxLen - 3))}...`
}

function formatUnreadableZipRefusal(shown: string): string {
  return `${PLUGIN_HANDOVER_REFUSAL_PREFIX}${shown} could not be read as a plain zip file, so its files could not be checked for secret keys. Make it again with \`zip -r\`, as in step 4 of ${PLUGIN_HANDOVER_REFERENCE}, and send that.`
}

function summarizeListPreview(items: string[]): string[] {
  return [
    ...items.slice(0, PLUGIN_HANDOVER_MAX_SHOWN_ITEMS),
    ...(items.length > PLUGIN_HANDOVER_MAX_SHOWN_ITEMS
      ? [`and ${items.length - PLUGIN_HANDOVER_MAX_SHOWN_ITEMS} more`]
      : []),
  ]
}

type ZipEocd = {
  listStart: number
  listBytes: number
  count: number
  comment: Buffer
}

type ZipCentralEntry = {
  size: number
  packed: number
  at: number
  rawName: Buffer
  name: string
  method: number
  isEncrypted: boolean
}

function parseZipEocd(buf: Buffer, totalSize: number): ZipEocd | undefined {
  const idx = buf.lastIndexOf('PK\x05\x06', undefined, 'latin1')
  if (idx === -1 || idx + 22 > buf.length) return undefined
  const count = buf.readUInt16LE(idx + 10)
  const listBytes = buf.readUInt32LE(idx + 12)
  const listStart = buf.readUInt32LE(idx + 16)
  if (
    buf.readUInt32LE(idx + 4) !== 0 ||
    buf.readUInt16LE(idx + 8) !== count ||
    count === 65535 ||
    idx + 22 + buf.readUInt16LE(idx + 20) !== buf.length ||
    listStart + listBytes !== totalSize - (buf.length - idx)
  ) {
    return undefined
  }
  return {
    listStart,
    listBytes,
    count,
    comment: buf.subarray(idx + 22),
  }
}

function parseZipCentralDirectory(
  buf: Buffer,
  count: number,
): ZipCentralEntry[] | undefined {
  const decoder = new TextDecoder()
  const entries: ZipCentralEntry[] = []
  let offset = 0
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      return undefined
    }
    const flags = buf.readUInt16LE(offset + 8)
    const nameEnd = offset + 46 + buf.readUInt16LE(offset + 28)
    const nextOffset =
      nameEnd + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32)
    const size = buf.readUInt32LE(offset + 24)
    const packed = buf.readUInt32LE(offset + 20)
    const at = buf.readUInt32LE(offset + 42)
    if (
      nextOffset > buf.length ||
      size === 0xffffffff ||
      packed === 0xffffffff ||
      at === 0xffffffff
    ) {
      return undefined
    }
    const rawName = buf.subarray(offset + 46, nameEnd)
    entries.push({
      size,
      packed,
      at,
      rawName,
      name:
        (flags & 2048) !== 0
          ? decoder.decode(rawName)
          : rawName.toString('latin1'),
      method: buf.readUInt16LE(offset + 10),
      isEncrypted: (flags & 1) === 1,
    })
    offset = nextOffset
  }
  return offset === buf.length ? entries : undefined
}

function isSafeArchiveEntryPath(name: string): boolean {
  if (
    !name ||
    name.includes('\0') ||
    name.startsWith('/') ||
    name.startsWith('\\')
  ) {
    return false
  }
  return !name.split(/[\\/]/).some(seg => seg === '..')
}

function isPluginArchiveEntry(entry: { name: string }): boolean {
  return (
    PLUGIN_MANIFEST_ENTRY_RE.test(entry.name) ||
    entry.name.toLowerCase().endsWith(PLUGIN_EXTENSION)
  )
}

function isNotFoundError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const SKIP_REASON_LABELS: Record<string, string> = {
  'too large': 'too large to check',
  'total limit': 'too large to check',
  'lfs pointer': 'its contents are stored elsewhere',
}

const SKIP_REASON_CODES: Record<string, string> = {
  'too large': 'over_size',
  'total limit': 'over_size',
  'lfs pointer': 'lfs_pointer',
}

async function inspectOversizedZipHandle(
  handle: Awaited<ReturnType<typeof open>>,
  seen: PluginHandoverFileIdentity,
  shown: string,
  hasPluginExt: boolean,
): Promise<PluginHandoverInspectResult> {
  const tailLen = Math.min(seen.size, PLUGIN_HANDOVER_EOCD_SCAN_BYTES)
  const tail = Buffer.alloc(tailLen)
  await handle.read(tail, 0, tailLen, seen.size - tailLen)
  const eocd = parseZipEocd(tail, seen.size)
  let cdBuf: Buffer | undefined
  if (eocd !== undefined && eocd.listBytes <= PLUGIN_HANDOVER_MAX_CD_BYTES) {
    cdBuf = Buffer.alloc(eocd.listBytes)
    await handle.read(cdBuf, 0, cdBuf.length, eocd.listStart)
  }
  const entries =
    eocd !== undefined && cdBuf !== undefined
      ? parseZipCentralDirectory(cdBuf, eocd.count)
      : undefined
  const isPlugin = hasPluginExt || entries?.some(isPluginArchiveEntry) === true
  if (isPlugin || entries === undefined) {
    return {
      kind: 'ask',
      seen,
      isPlugin,
      recorded: {
        case: isPlugin ? 'too_large_plugin' : 'too_large_unlistable',
        count: 0,
      },
      found: `${shown} is too large to check for secret keys`,
      question: `${shown} is too large to check for secret keys. Send it anyway?`,
    }
  }
  return { kind: 'other', seen }
}

type ZipScanBudget = {
  bytes: number
  entries: number
}

type ZipScanOutput = {
  findings: SecretScanFinding[]
  notScanned: SecretScanSkipped[]
  capped: boolean
  zipsInside: Map<string, Uint8Array>
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function scanZipEntries(
  buf: Buffer,
  listStart: number,
  entries: ZipCentralEntry[],
  budget: ZipScanBudget,
): Promise<ZipScanOutput | undefined> {
  const maxEntries = budget.entries
  const filesToScan = new Map<string, number>()
  const dirs = new Set<string>()
  let valid = true
  let cursor = 0
  let prevHasDataDesc = false
  const sortedEntries = [...entries].sort((a, b) => a.at - b.at)

  for (const entry of sortedEntries) {
    const isDir = entry.name.endsWith('/')
    const gap = entry.at - cursor
    const hasLocalHeader =
      entry.at + 30 <= buf.length && buf.readUInt32LE(entry.at) === 0x04034b50
    const nameEnd = hasLocalHeader
      ? entry.at + 30 + buf.readUInt16LE(entry.at + 26)
      : 0
    const localFlags = hasLocalHeader ? buf.readUInt16LE(entry.at + 6) : 0
    valid =
      valid &&
      hasLocalHeader &&
      (gap === 0 || (prevHasDataDesc && (gap === 12 || gap === 16))) &&
      (localFlags & 1) === 0 &&
      buf.readUInt16LE(entry.at + 8) === entry.method &&
      buf.subarray(entry.at + 30, nameEnd).equals(entry.rawName) &&
      ((localFlags & 8) !== 0 ||
        (buf.readUInt32LE(entry.at + 18) === entry.packed &&
          buf.readUInt32LE(entry.at + 22) === entry.size)) &&
      !entry.isEncrypted &&
      !filesToScan.has(entry.name) &&
      !dirs.has(entry.name) &&
      entry.name !== '__proto__' &&
      isSafeArchiveEntryPath(entry.name) &&
      !(isDir && (entry.size > 0 || entry.packed > 2))
    if (!valid) break
    cursor = nameEnd + buf.readUInt16LE(entry.at + 28) + entry.packed
    prevHasDataDesc = (localFlags & 8) !== 0
    if (isDir) {
      dirs.add(entry.name)
    } else if (filesToScan.size + dirs.size < maxEntries) {
      filesToScan.set(entry.name, entry.size)
    }
  }

  const tailGap = listStart - cursor
  valid =
    valid &&
    entries.length > 0 &&
    (tailGap === 0 || (prevHasDataDesc && (tailGap === 12 || tailGap === 16)))

  if (!valid) {
    return undefined
  }

  budget.entries -= filesToScan.size + dirs.size

  const orderedFiles = [...filesToScan.entries()].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
  )
  const extractList: string[] = []
  const notScanned: SecretScanSkipped[] = []
  for (const [name, size] of orderedFiles) {
    if (size > SCAN_SECRETS_MAX_FILE_BYTES) {
      notScanned.push({ path: name, reason: 'too large' })
      continue
    }
    if (size > budget.bytes) {
      notScanned.push({ path: name, reason: 'total limit' })
      continue
    }
    budget.bytes -= size
    extractList.push(name)
  }

  const zipsInside = new Map<string, Uint8Array>()
  const findings: SecretScanFinding[] = []
  try {
    const { unzipSync } = await import('fflate')
    const want = new Set(extractList)
    const extracted = unzipSync(new Uint8Array(buf), {
      filter: file => want.has(file.name),
    })
    for (const name of extractList) {
      const data = Object.hasOwn(extracted, name) ? extracted[name] : undefined
      if (data === undefined) {
        notScanned.push({ path: name, reason: 'unreadable' })
        continue
      }
      if (
        data.byteLength >= 4 &&
        Buffer.from(data.subarray(0, 4)).toString('latin1') ===
          ZIP_LOCAL_FILE_MAGIC
      ) {
        zipsInside.set(name, data)
        continue
      }
      const text = Buffer.from(data).toString('utf8')
      if (text.startsWith(LFS_POINTER_PREFIX)) {
        notScanned.push({ path: name, reason: 'lfs pointer' })
        continue
      }
      const kinds = new Set<string>([
        ...detectSecretKinds(text),
        ...detectSecretKinds(name),
      ])
      if (kinds.size > 0) {
        findings.push({
          path: redactSecretFilename(name),
          kinds: [...kinds],
        })
      }
    }
  } catch {
    return undefined
  }

  return {
    findings,
    notScanned,
    capped: entries.length > maxEntries,
    zipsInside,
  }
}

async function inspectZipBuffer(
  buf: Buffer,
  seen: PluginHandoverFileIdentity,
  shown: string,
  hasPluginExt: boolean,
): Promise<PluginHandoverInspectResult> {
  const eocd = parseZipEocd(buf, buf.length)
  const entries =
    eocd === undefined
      ? undefined
      : parseZipCentralDirectory(
          buf.subarray(eocd.listStart, eocd.listStart + eocd.listBytes),
          eocd.count,
        )
  if (eocd === undefined || entries === undefined) {
    if (hasPluginExt) {
      return { kind: 'refused', refusal: formatUnreadableZipRefusal(shown) }
    }
    return {
      kind: 'ask',
      seen,
      isPlugin: false,
      recorded: { case: 'unlistable', count: 0 },
      found: `${shown} could not be checked for secret keys`,
      question: `${shown} could not be checked for secret keys. Send it anyway?\n\nIt may be damaged.`,
    }
  }

  if (!hasPluginExt && !entries.some(isPluginArchiveEntry)) {
    return { kind: 'other', seen }
  }

  // Official 2.1.326 #99: unpack and scan nested zip/OOXML (.docx, .xlsx, etc.)
  // entries one level deep using the shared byte/entry budget before asking.
  const budget: ZipScanBudget = {
    bytes: SCAN_SECRETS_MAX_TOTAL_BYTES,
    entries: SCAN_SECRETS_MAX_ENTRIES,
  }
  const outer = await scanZipEntries(buf, eocd.listStart, entries, budget)
  if (outer === undefined) {
    return { kind: 'refused', refusal: formatUnreadableZipRefusal(shown) }
  }

  const findingLines = outer.findings.map(
    f =>
      `${truncateDisplayLabel(f.path, PLUGIN_HANDOVER_SHOWN_NAME_MAX)} (${f.kinds.join(', ')})`,
  )
  const uncheckedLines = outer.notScanned.map(
    item =>
      `${truncateDisplayLabel(item.path, PLUGIN_HANDOVER_SHOWN_NAME_MAX)} (${SKIP_REASON_LABELS[item.reason] ?? 'could not be read'})`,
  )
  const uncheckedCodes = outer.notScanned.map(
    item => SKIP_REASON_CODES[item.reason] ?? 'unreadable',
  )
  let capped = outer.capped

  for (const [nestedName, nestedBytes] of outer.zipsInside) {
    if (budget.entries <= 0) {
      capped = true
      continue
    }
    const nestedBuf = Buffer.from(
      nestedBytes.buffer,
      nestedBytes.byteOffset,
      nestedBytes.byteLength,
    )
    const nestedEocd = parseZipEocd(nestedBuf, nestedBuf.length)
    const nestedEntries =
      nestedEocd === undefined
        ? undefined
        : parseZipCentralDirectory(
            nestedBuf.subarray(
              nestedEocd.listStart,
              nestedEocd.listStart + nestedEocd.listBytes,
            ),
            nestedEocd.count,
          )
    const nestedResult =
      nestedEocd === undefined || nestedEntries === undefined
        ? undefined
        : await scanZipEntries(
            nestedBuf,
            nestedEocd.listStart,
            nestedEntries,
            budget,
          )
    const shownNested = truncateDisplayLabel(
      nestedName,
      PLUGIN_HANDOVER_SHOWN_NAME_MAX,
    )
    if (nestedResult === undefined) {
      uncheckedLines.push(`${shownNested} (could not be opened to check it)`)
      uncheckedCodes.push('nested_zip')
      continue
    }
    capped ||= nestedResult.capped
    const suffix = ` in ${shownNested}`
    for (const f of nestedResult.findings) {
      findingLines.push(
        `${truncateDisplayLabel(f.path, PLUGIN_HANDOVER_SHOWN_NAME_MAX)}${suffix} (${f.kinds.join(', ')})`,
      )
    }
    for (const item of nestedResult.notScanned) {
      uncheckedLines.push(
        `${truncateDisplayLabel(item.path, PLUGIN_HANDOVER_SHOWN_NAME_MAX)}${suffix} (${SKIP_REASON_LABELS[item.reason] ?? 'could not be read'})`,
      )
      uncheckedCodes.push(SKIP_REASON_CODES[item.reason] ?? 'unreadable')
    }
    for (const deeperName of nestedResult.zipsInside.keys()) {
      uncheckedLines.push(
        `${truncateDisplayLabel(deeperName, PLUGIN_HANDOVER_SHOWN_NAME_MAX)}${suffix} (a zip inside a zip, not opened)`,
      )
      uncheckedCodes.push('nested_deeper')
    }
  }

  const commentKinds = detectSecretKinds(eocd.comment.toString('utf8'))

  if (
    findingLines.length === 0 &&
    commentKinds.length === 0 &&
    uncheckedLines.length === 0 &&
    !capped
  ) {
    return { kind: 'clean', seen }
  }

  const hasPossibleSecret = findingLines.length > 0 || commentKinds.length > 0
  if (capped) uncheckedCodes.push('too_many_entries')
  const uniqueCodes = [...new Set(uncheckedCodes)]
  const [firstCode, ...restCodes] = uniqueCodes

  const foundParts: string[] = []
  if (findingLines.length > 0) {
    foundParts.push(
      `a check found a possible secret key in ${findingLines.length} of the files in ${shown}`,
    )
  }
  if (commentKinds.length > 0) {
    foundParts.push(
      `a check found a possible secret key in the comment of ${shown}`,
    )
  }
  if (uncheckedLines.length > 0) {
    foundParts.push(
      `${uncheckedLines.length} of the files in ${shown} could not be checked for secret keys`,
    )
  }
  if (capped) {
    foundParts.push(`${shown} has too many files for all of them to be checked`)
  }

  const questionLines: string[] = [
    hasPossibleSecret
      ? `${shown} may contain a secret key. Anyone who opens the file could read it. Send it anyway?`
      : `Part of ${shown} could not be checked for secret keys. Send it anyway?`,
    '',
  ]
  if (findingLines.length > 0) {
    questionLines.push(
      `Found in ${findingLines.length} ${findingLines.length === 1 ? 'file' : 'files'}:`,
      ...summarizeListPreview(findingLines),
    )
  }
  if (commentKinds.length > 0) {
    questionLines.push(
      `Found in the zip file's own comment: ${commentKinds.join(', ')}`,
    )
  }
  if (uncheckedLines.length > 0) {
    questionLines.push(
      `${uncheckedLines.length} ${uncheckedLines.length === 1 ? 'file' : 'files'} could not be checked:`,
      ...summarizeListPreview(uncheckedLines),
    )
  }
  if (capped) {
    questionLines.push(
      'It and any zip files inside it have too many files to check them all.',
    )
  }

  return {
    kind: 'ask',
    seen,
    isPlugin: true,
    recorded: {
      case:
        firstCode === undefined
          ? 'plugin_possible_key'
          : hasPossibleSecret
            ? 'plugin_key_and_unchecked'
            : `plugin_unchecked_${restCodes.length === 0 ? firstCode : 'mixed'}`,
      count: findingLines.length + uncheckedLines.length,
    },
    found: foundParts.join(', and '),
    question: questionLines.join('\n'),
  }
}

async function verifyHandoverFileBasis(
  filePath: string,
  basis: PluginHandoverBasis,
): Promise<boolean> {
  const flags =
    fsConstants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsConstants.O_NONBLOCK ?? 0))
  const handle = await open(filePath, flags).catch(() => undefined)
  if (handle === undefined) return false
  try {
    const st = await handle.stat()
    if (!st.isFile()) return false
    if (basis === 'no_zip_start') {
      const magic = Buffer.alloc(4)
      const { bytesRead } = await handle.read(magic, 0, 4, 0)
      return (
        magic.subarray(0, bytesRead).toString('latin1') !== ZIP_LOCAL_FILE_MAGIC
      )
    }
    if (st.size > SCAN_SECRETS_MAX_TOTAL_BYTES) return false
    const data = await handle.readFile()
    return sha256Hex(data) === basis.digest
  } catch {
    return false
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * #2190 (v2.1.323): Inspect a candidate file path before handing it over to
 * the user in claude.ai chat / Cowork. Plain non-plugin files return `other`;
 * `.plugin` files and `.zip` archives holding `.claude-plugin/` or `.plugin`
 * entries are unpacked safely and scanned for secret keys.
 */
export async function inspectPluginHandoverArchive(
  filePath: string,
  shownName?: string,
): Promise<PluginHandoverInspectResult> {
  const shown = truncateDisplayLabel(
    shownName ?? basename(filePath),
    PLUGIN_HANDOVER_SHOWN_NAME_MAX,
  )
  const hasPluginExt = filePath.toLowerCase().endsWith(PLUGIN_EXTENSION)
  let isArchiveCandidate = PLUGIN_ARCHIVE_NAME_RE.test(filePath)
  let seen: PluginHandoverFileIdentity | undefined

  const flags =
    fsConstants.O_RDONLY |
    (process.platform === 'win32' ? 0 : (fsConstants.O_NONBLOCK ?? 0))

  let handle: Awaited<ReturnType<typeof open>> | 'absent' | 'failed'
  try {
    handle = await open(filePath, flags)
  } catch (err) {
    if (isNotFoundError(err)) {
      const stillMissing = await lstat(filePath).then(
        () => false,
        err2 => isNotFoundError(err2),
      )
      handle = stillMissing ? 'absent' : 'failed'
    } else {
      handle = 'failed'
    }
  }

  if (typeof handle === 'string') {
    if (isArchiveCandidate && handle === 'failed') {
      return { kind: 'refused', refusal: PLUGIN_HANDOVER_CHECK_FAILED_MSG }
    }
    const st = await stat(filePath).catch(() => undefined)
    return {
      kind: 'other',
      ...(st ? { seen: snapshotFileIdentity(st) } : {}),
    }
  }

  try {
    try {
      const st = await handle.stat()
      seen = snapshotFileIdentity(st)
      if (!st.isFile()) return { kind: 'other', seen }
      const magic = Buffer.alloc(4)
      const { bytesRead } = await handle.read(magic, 0, 4, 0)
      const isZip =
        magic.subarray(0, bytesRead).toString('latin1') === ZIP_LOCAL_FILE_MAGIC
      if (!hasPluginExt && !isZip) {
        return { kind: 'other', seen, basis: 'no_zip_start' }
      }
      isArchiveCandidate = true
      if (!isZip) {
        return { kind: 'refused', refusal: formatUnreadableZipRefusal(shown) }
      }
      if (st.size > SCAN_SECRETS_MAX_TOTAL_BYTES) {
        return await inspectOversizedZipHandle(
          handle,
          seen,
          shown,
          hasPluginExt,
        )
      }
      const data = await handle.readFile()
      const zipResult = await inspectZipBuffer(data, seen, shown, hasPluginExt)
      return zipResult.kind === 'refused'
        ? zipResult
        : { ...zipResult, basis: { digest: sha256Hex(data) } }
    } finally {
      await handle.close().catch(() => undefined)
    }
  } catch {
    if (!isArchiveCandidate) return { kind: 'other', seen }
    return { kind: 'refused', refusal: PLUGIN_HANDOVER_CHECK_FAILED_MSG }
  }
}

export async function checkPluginHandoverBeforeSend(
  paths: readonly string[],
  options: {
    askUser?: PluginHandoverAskFn
    signal?: AbortSignal
  } = {},
): Promise<string | undefined> {
  const uniquePaths = [...new Set(paths.map(p => p.trim()).filter(Boolean))]
  if (uniquePaths.length === 0) return undefined

  const checked: Array<{
    path: string
    shown: string
    seen?: PluginHandoverFileIdentity
    basis?: PluginHandoverBasis
  }> = []
  const asks: Array<
    Extract<PluginHandoverInspectResult, { kind: 'ask' }> & { shown: string }
  > = []

  for (const filePath of uniquePaths) {
    const shown = truncateDisplayLabel(
      basename(filePath),
      PLUGIN_HANDOVER_SHOWN_NAME_MAX,
    )
    const inspected = await inspectPluginHandoverArchive(filePath, shown)
    if (inspected.kind === 'refused') {
      return inspected.refusal
    }
    checked.push({
      path: filePath,
      shown,
      seen: inspected.seen,
      basis: inspected.basis,
    })
    if (inspected.kind === 'ask') {
      asks.push({ ...inspected, shown })
    }
  }

  for (const item of asks) {
    const stoppedMsg = `${PLUGIN_HANDOVER_REFUSAL_PREFIX}the turn was stopped before the person answered whether to send ${item.shown}.`
    if (options.signal?.aborted) {
      return stoppedMsg
    }
    let answer: PluginHandoverAskAnswer | undefined
    if (options.askUser) {
      answer = await Promise.resolve(
        options.askUser(
          {
            source: PLUGIN_HANDOVER_CHECK_SOURCE,
            header: 'Key check',
            question: item.question,
            choices: [
              {
                value: 'hold',
                label: "Don't send",
                description:
                  'Nothing is sent. You can ask Claude to change the file first.',
              },
              {
                value: 'send',
                label: 'Send it',
                description: 'The file is added to this chat as it is.',
              },
            ],
            personOnly: true,
          },
          options.signal,
        ),
      ).catch(() => undefined)
    }

    if (answer?.kind === 'aborted' && options.signal?.aborted) {
      return stoppedMsg
    }
    if (answer === undefined || answer.kind === 'unanswered') {
      return (
        `${PLUGIN_HANDOVER_REFUSAL_PREFIX}${item.found}, and this session could not ask the person whether to send it anyway. Tell the person so, in plain words.` +
        (item.isPlugin
          ? ` To find and leave out such files, follow ${PLUGIN_HANDOVER_REFERENCE}.`
          : '')
      )
    }
    if (answer.kind === 'chose' && answer.value === 'send') {
      continue
    }
    const typed =
      answer.kind === 'declined' && answer.typedAnswer !== undefined
        ? answer.typedAnswer
            .replace(/[\r\n\t]+/g, ' ')
            .trim()
            .slice(0, PLUGIN_HANDOVER_TYPED_MAX)
        : ''
    return (
      `${PLUGIN_HANDOVER_REFUSAL_PREFIX}${item.found}, and the person, asked whether to send it anyway, did not choose to` +
      (typed === '' ? '.' : `, and wrote: "${typed}".`) +
      ` Leave ${item.shown} unsent, under this or any other name and in any other form, unless the person asks for it. If they do, call SendUserFile again: they are asked again, and only their own pick of Send it sends it.` +
      (item.isPlugin
        ? ` If they want it changed first, start again from step 1 of ${PLUGIN_HANDOVER_REFERENCE}.`
        : '')
    )
  }

  if (asks.length > 0) {
    for (const item of checked) {
      const currentStat = await stat(item.path).catch(() => undefined)
      const currentIdentity = currentStat
        ? snapshotFileIdentity(currentStat)
        : undefined
      const diff = compareFileIdentity(item.seen, currentIdentity)
      if (diff === undefined) {
        continue
      }
      // Official 2.1.326 #98: if timestamps or inode were restamped while the
      // user answered "Send it" (e.g., Cowork / container overlay), verify the
      // file's SHA-256 digest (or non-zip header) still matches before refusing.
      const isRestampDiff =
        diff === 'times' || diff === 'ino' || diff === 'ino_and_times'
      if (
        item.basis !== undefined &&
        (item.basis !== 'no_zip_start' || isRestampDiff) &&
        (await verifyHandoverFileBasis(item.path, item.basis))
      ) {
        const afterStat = await stat(item.path).catch(() => undefined)
        const afterIdentity = afterStat
          ? snapshotFileIdentity(afterStat)
          : undefined
        if (compareFileIdentity(currentIdentity, afterIdentity) === undefined) {
          continue
        }
      }
      return `${PLUGIN_HANDOVER_REFUSAL_PREFIX}${item.shown} changed while the person was being asked. Send it again, and it is checked again.`
    }
  }

  return undefined
}

function extractSendUserFilePaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  const rec = input as Record<string, unknown>
  const nested =
    rec.input && typeof rec.input === 'object'
      ? (rec.input as Record<string, unknown>)
      : rec
  const paths: string[] = []
  if (typeof nested.file_path === 'string' && nested.file_path.trim()) {
    paths.push(nested.file_path)
  }
  if (typeof nested.files === 'string' && nested.files.trim()) {
    paths.push(nested.files)
  } else if (Array.isArray(nested.files)) {
    for (const item of nested.files) {
      if (typeof item === 'string' && item.trim()) paths.push(item)
    }
  }
  if (typeof nested.attachments === 'string' && nested.attachments.trim()) {
    paths.push(nested.attachments)
  } else if (Array.isArray(nested.attachments)) {
    for (const item of nested.attachments) {
      if (typeof item === 'string' && item.trim()) paths.push(item)
    }
  }
  return paths
}

export function registerPluginAuthoringHooks(
  on: (
    event: string,
    matcherOrHandler: unknown,
    maybeHandler?: unknown,
  ) => void,
  complianceOff: () => PluginAuthoringComplianceOff = getPluginAuthoringComplianceOff,
  options?: {
    isChatSession?: () => boolean
    askUser?: PluginHandoverAskFn
  },
): void {
  on(
    'skill.prompt',
    { skill: 'plugin-authoring', source: 'built-in' },
    async (
      _api: unknown,
      input: { text?: string },
      next: (arg: { text?: string }) => Promise<{ text?: string }>,
    ) => {
      const res = await next(input)
      const off = complianceOff()
      if (off === undefined) return res
      const reason = SKILL_PROMPT_COMPLIANCE_REASONS[off]
      return {
        ...res,
        text: `${res.text ?? ''}\n\nThe secret scan tool is not available in this session: ${reason} So the scan in the share steps cannot run here, and a mod cannot be shared until it can: do not open, print or search any file in the folder of a mod to be shared, and tell the person why it can't be shared.`,
      }
    },
  )
  on(
    'tool.call',
    { tool: SCAN_SECRETS_FULL_TOOL_NAME },
    async (
      _api: unknown,
      input: unknown,
      next: (arg: unknown) => Promise<unknown>,
    ) => {
      const off = complianceOff()
      if (off !== undefined) {
        return {
          result: `Result: the scan could not run: ${TOOL_CALL_COMPLIANCE_REASONS[off]}`,
          isError: true,
        }
      }
      return next(input)
    },
  )
  on(
    'tool.call',
    { tool: 'SendUserFile' },
    async (
      _api: unknown,
      input: unknown,
      next: (arg: unknown) => Promise<unknown>,
    ) => {
      const inChat = options?.isChatSession
        ? options.isChatSession()
        : isPluginAuthoringChatSession()
      if (!inChat) {
        return next(input)
      }
      const paths = extractSendUserFilePaths(input)
      if (paths.length === 0) {
        return next(input)
      }
      const refusal = await checkPluginHandoverBeforeSend(paths, {
        askUser: options?.askUser,
      })
      if (refusal !== undefined) {
        return {
          result: refusal,
          isError: true,
        }
      }
      return next(input)
    },
  )
}

export function registerPluginAuthoringBuiltinPlugin(): void {
  const { leftoverFu } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/plugins/functionHooksModules.js') as typeof import('../../utils/plugins/functionHooksModules.js')
  registerBuiltinPlugin({
    name: PLUGIN_AUTHORING_PLUGIN_NAME,
    description: PLUGIN_AUTHORING_PLUGIN_DESCRIPTION,
    // gold uS omits defaultEnabled → PZ ?? true
    isAvailable: isPluginAuthoringPluginAvailable,
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-plugin-authoring',
      ),
      {
        register: (on: unknown) => {
          registerPluginAuthoringHooks(
            on as (
              event: string,
              matcherOrHandler: unknown,
              maybeHandler?: unknown,
            ) => void,
          )
        },
      },
      () => ({
        scan: {
          hooks: ['skill.prompt', 'tool.call'],
          calls: [],
        },
        files: {},
      }),
    ),
    skills: [createPluginAuthoringSkill()],
    mcpServers: {
      [SCAN_SECRETS_MCP_SERVER_NAME]: createPluginAuthoringMcpServer(),
    },
  })
}
