/**
 * densable 2.1.289 `cc-plugin-plugin-authoring` — yfe + uS({skills:[f]}).
 * Skill BODY stays goldOfficialMissingSkills; this is the /plugin listing.
 * v2.1.300 #806: registers `scan_secrets` MCP tool (`mcp__plugin-authoring__scan_secrets`).
 */
import { lstat, open, readdir, stat } from 'fs/promises'
import { isAbsolute, join, resolve } from 'path'
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
export const SCAN_SECRETS_MAX_FILE_BYTES = 10 * 1024 * 1024
export const SCAN_SECRETS_MAX_TOTAL_BYTES = 25 * 1024 * 1024
export const SCAN_SECRETS_MAX_ENTRIES = 20_000
export const SCAN_SECRETS_MAX_FINDINGS = 100
export const SCAN_SECRETS_MAX_SKIPPED = 30
const REDACTED_SECRET_NAME = '<name holding a secret>'
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'

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

export function registerPluginAuthoringBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: PLUGIN_AUTHORING_PLUGIN_NAME,
    description: PLUGIN_AUTHORING_PLUGIN_DESCRIPTION,
    // gold uS omits defaultEnabled → PZ ?? true
    isAvailable: isPluginAuthoringPluginAvailable,
    skills: [createPluginAuthoringSkill()],
    mcpServers: {
      [SCAN_SECRETS_MCP_SERVER_NAME]: createPluginAuthoringMcpServer(),
    },
  })
}
