import { createHash, X509Certificate } from 'crypto'
import memoize from 'lodash-es/memoize.js'
import { logForDebugging } from './debug.js'
import { hasNodeOption, isEnvTruthy } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { parseCertStoreSources } from './residualFinalEnvGates.js'

const warnedExtraCerts = new Set<string>()

const PEM_BLOCK_RE = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g

function warnExtraCertsOnce(
  reason: 'partlyLoaded' | 'unloadable' | 'selfNamed',
  fingerprintOrHash: string,
  fingerprint?: string,
): void {
  const key = `${reason}:${fingerprintOrHash}`
  if (warnedExtraCerts.has(key)) return
  warnedExtraCerts.add(key)

  const messages: Record<typeof reason, string> = {
    partlyLoaded:
      'Claude Code used only the certificates that it could read in full from the NODE_EXTRA_CA_CERTS file: its certificates cannot be loaded together, most likely because one of them is cut off or damaged, or because a line break is missing between two of them. Each -----BEGIN CERTIFICATE----- marker and each matching END marker must be alone on its line. Fix the file so that every certificate in it is used.',
    unloadable:
      'Claude Code ignored all of the NODE_EXTRA_CA_CERTS file: it holds no certificate that Claude Code can read. The file must hold certificates in PEM format, in which each certificate is base64 text between a -----BEGIN CERTIFICATE----- line and the matching END line. Claude Code does not read a binary (DER) file, UTF-16 text, base64 text without those two lines, or a certificate that is cut off or damaged. Fix or replace the file, or unset NODE_EXTRA_CA_CERTS if you do not need it.',
    selfNamed: `Claude Code ignored the certificate with SHA-256 fingerprint ${fingerprint ?? fingerprintOrHash} in the NODE_EXTRA_CA_CERTS file: it names itself as its issuer, but Claude Code could not confirm that the certificate's own key signed it. Run Claude Code with --debug to write the certificate's subject and the cause to the debug log. If you do not know where the certificate came from, remove it from the file. If another root certificate of the same CA signed it, as when a CA renews its root with a new key, add the root that signed it to the file, if you still trust that root. If connections still fail, take that root out of the file again. Then, or if no other root signed it, set CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP=1, but only if you trust the ignored certificate, such as a self-signed root whose signature Claude Code cannot check or a server's own certificate. The variable keeps every certificate that Claude Code would ignore for this reason, whoever signed it, and can break connections that work without it.`,
  }
  console.error(messages[reason])
}

function tryLoadSecureContextCa(
  tls: typeof import('tls'),
  ca: string,
): string | undefined {
  try {
    tls.createSecureContext({ ca: [ca] })
    return undefined
  } catch (err) {
    return String(err)
  }
}

/**
 * Parse and salvage usable PEM certificates from NODE_EXTRA_CA_CERTS content.
 * Warns to stderr when the file is empty/non-PEM/unloadable or only partly loadable.
 */
export function parseExtraCACertificatesContent(
  content: string,
  tls: typeof import('tls'),
  extraCertsPath: string,
): string | undefined {
  const contentHash = createHash('sha256').update(content).digest('hex')
  const trimmed = content.trim()
  if (!trimmed) {
    logForDebugging(
      `CA certs: NODE_EXTRA_CA_CERTS (${extraCertsPath}) is empty or contains no usable certificates`,
      { level: 'warn' },
    )
    warnExtraCertsOnce('unloadable', contentHash)
    return undefined
  }

  const wholeError = tryLoadSecureContextCa(tls, content)
  const blocks = content.match(PEM_BLOCK_RE) ?? []

  const usable = blocks.filter(block => {
    if (block.startsWith('-----BEGIN TRUSTED')) return false
    try {
      new X509Certificate(block)
      return tryLoadSecureContextCa(tls, block) === undefined
    } catch {
      return false
    }
  })

  if (
    wholeError === undefined &&
    blocks.length > 0 &&
    usable.length === blocks.length
  ) {
    return content
  }

  if (usable.length > 0) {
    logForDebugging(
      `CA certs: The runtime cannot load the NODE_EXTRA_CA_CERTS file as one CA list entry (${wholeError ?? 'malformed content'}); kept only the ${usable.length} certificate(s) in it that the runtime loads one by one`,
      { level: 'error' },
    )
    warnExtraCertsOnce('partlyLoaded', contentHash)
    return usable.join('\n')
  }

  logForDebugging(
    `CA certs: The runtime cannot load the NODE_EXTRA_CA_CERTS file (${wholeError ?? 'no valid PEM certificates'}); ignored it`,
    { level: 'error' },
  )
  warnExtraCertsOnce('unloadable', contentHash)
  return undefined
}

function stripPemHeaders(pem: string): string {
  return pem.replace(/-----[A-Z ]+-----|\s/g, '')
}

/**
 * Drop self-named certificates (subject === issuer) whose own key did not sign them,
 * unless `CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP` is set.
 */
export function filterSelfNamedCertificates(
  certs: string[],
  bundledRoots: readonly string[],
  extraContent: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  knownRootLookup?: (pem: string) => { expires: number } | undefined,
): string[] {
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP)) {
    logForDebugging(
      'CA certs: CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP is set: a certificate whose subject and issuer names match stays, whoever signed it',
      { level: 'warn' },
    )
    return certs
  }
  const bundledSet = new Set(bundledRoots.map(stripPemHeaders))
  const kept: string[] = []
  for (const entry of certs) {
    // Official 2.1.321 (#1931): fast-path known roots via precomputed SHA-256
    // table without constructing X509Certificate.
    if (knownRootLookup?.(entry) !== undefined) {
      kept.push(entry)
      continue
    }
    const blocks = entry.match(PEM_BLOCK_RE)
    if (!blocks || blocks.length !== 1) {
      kept.push(entry)
      continue
    }
    try {
      const cert = new X509Certificate(blocks[0])
      if (cert.subject !== cert.issuer) {
        kept.push(entry)
        continue
      }
      if (bundledSet.has(cert.raw.toString('base64'))) {
        kept.push(entry)
        continue
      }
      let selfSigned = false
      try {
        selfSigned = cert.verify(cert.publicKey)
      } catch {
        selfSigned = false
      }
      if (selfSigned) {
        kept.push(entry)
      } else {
        logForDebugging(
          `CA certs: Dropped self-named certificate ${cert.fingerprint256} whose own key did not sign it`,
          { level: 'warn' },
        )
        if (extraContent && extraContent.includes(blocks[0].trim())) {
          warnExtraCertsOnce(
            'selfNamed',
            cert.fingerprint256,
            cert.fingerprint256,
          )
        }
      }
    } catch {
      kept.push(entry)
    }
  }
  return kept
}

/**
 * Drop looped cross-certificates that share subject & public key with a valid self-signed root
 * in the list, unless `CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP` is set.
 */
export function filterLoopedCrossCertificates(
  certs: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_LOOPED_CROSS_CERT_DROP)) {
    return certs
  }
  const parsed: Array<{ entry: string; cert?: X509Certificate }> = certs.map(
    entry => {
      const blocks = entry.match(PEM_BLOCK_RE)
      if (!blocks || blocks.length !== 1) return { entry }
      try {
        return { entry, cert: new X509Certificate(blocks[0]) }
      } catch {
        return { entry }
      }
    },
  )
  const rootsBySubject = new Map<string, X509Certificate[]>()
  for (const { cert } of parsed) {
    if (!cert || !cert.ca || cert.subject !== cert.issuer) continue
    const list = rootsBySubject.get(cert.subject) ?? []
    list.push(cert)
    rootsBySubject.set(cert.subject, list)
  }
  const now = Date.now()
  return parsed
    .filter(({ cert }) => {
      if (!cert || cert.subject === cert.issuer) return true
      const candidates = rootsBySubject.get(cert.subject)
      if (!candidates) return true
      const hasMatchingRoot = candidates.some(root => {
        try {
          return (
            new Date(root.validFrom).getTime() <= now &&
            new Date(root.validTo).getTime() > now &&
            cert.publicKey.equals(root.publicKey) &&
            root.checkIssued(root) &&
            root.verify(root.publicKey)
          )
        } catch {
          return false
        }
      })
      if (hasMatchingRoot) {
        logForDebugging(
          `CA certs: Dropped looped cross-certificate ${cert.subject.replaceAll('\n', ', ')} beside its root`,
        )
        return false
      }
      return true
    })
    .map(item => item.entry)
}

/**
 * Load CA certificates for TLS connections.
 *
 * Since setting `ca` on an HTTPS agent replaces the default certificate store,
 * we must always include base CAs (either system or bundled Mozilla) when returning.
 *
 * Returns undefined when no custom CA configuration is needed, allowing the
 * runtime's default certificate handling to apply.
 *
 * Behavior:
 * - Neither NODE_EXTRA_CA_CERTS nor --use-system-ca/--use-openssl-ca set: undefined (runtime defaults)
 * - NODE_EXTRA_CA_CERTS only: bundled Mozilla CAs + extra cert file contents
 * - --use-system-ca or --use-openssl-ca only: system CAs
 * - --use-system-ca + NODE_EXTRA_CA_CERTS: system CAs + extra cert file contents
 *
 * Memoized for performance. Call clearCACertsCache() to invalidate after
 * environment variable changes (e.g., after trust dialog applies settings.json).
 *
 * Reads ONLY `process.env.NODE_EXTRA_CA_CERTS`. `caCertsConfig.ts` populates
 * that env var from settings.json at CLI init; this module stays config-free
 * so `proxy.ts`/`mtls.ts` don't transitively pull in the command registry.
 */
export const getCACertificates = memoize((): string[] | undefined => {
  // Official JEm densable — CLAUDE_CODE_CERT_STORE=bundled,system (order unique).
  const certStoreSources = parseCertStoreSources({
    onUnrecognized: token => {
      logForDebugging(
        `CA certs: unrecognized CLAUDE_CODE_CERT_STORE source '${token}', ignoring`,
        { level: 'warn' },
      )
    },
  })
  const useSystemCA =
    certStoreSources.includes('system') ||
    hasNodeOption('--use-system-ca') ||
    hasNodeOption('--use-openssl-ca')
  // Explicit CERT_STORE=bundled forces bundled base even without extra certs.
  const forceBundled = certStoreSources.includes('bundled')

  const extraCertsPath = process.env.NODE_EXTRA_CA_CERTS

  logForDebugging(
    `CA certs: useSystemCA=${useSystemCA}, forceBundled=${forceBundled}, extraCertsPath=${extraCertsPath}, certStore=${certStoreSources.join(',') || '(default)'}`,
  )

  // If neither is set, return undefined (use runtime defaults, no override)
  if (!useSystemCA && !extraCertsPath && !forceBundled) {
    return undefined
  }

  // Deferred load: Bun's node:tls module eagerly materializes ~150 Mozilla
  // root certificates (~750KB heap) on import, even if tls.rootCertificates
  // is never accessed. Most users hit the early return above, so we only
  // pay this cost when custom CA handling is actually needed.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const tls = require('tls') as typeof import('tls')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const certs: string[] = []

  if (useSystemCA) {
    // Load system CA store (Bun API)
    const getCACerts = (
      tls as typeof tls & { getCACertificates?: (type: string) => string[] }
    ).getCACertificates
    const systemCAs = getCACerts?.('system')
    if (systemCAs && systemCAs.length > 0) {
      certs.push(...systemCAs)
      logForDebugging(
        `CA certs: Loaded ${certs.length} system CA certificates (--use-system-ca)`,
      )
    } else if (!getCACerts && !extraCertsPath) {
      // Under Node.js where getCACertificates doesn't exist and no extra certs,
      // return undefined to let Node.js handle --use-system-ca natively.
      logForDebugging(
        'CA certs: --use-system-ca set but system CA API unavailable, deferring to runtime',
      )
      return undefined
    } else {
      // System CA API returned empty or unavailable; fall back to bundled root certs
      certs.push(...tls.rootCertificates)
      logForDebugging(
        `CA certs: Loaded ${certs.length} bundled root certificates as base (--use-system-ca fallback)`,
      )
    }
  } else {
    // Must include bundled Mozilla CAs as base since ca replaces defaults
    certs.push(...tls.rootCertificates)
    logForDebugging(
      `CA certs: Loaded ${certs.length} bundled root certificates as base`,
    )
  }

  // Append extra certs from file
  let parsedExtraCerts: string | undefined
  if (extraCertsPath) {
    try {
      const extraCert = getFsImplementation().readFileSync(extraCertsPath, {
        encoding: 'utf8',
      })
      parsedExtraCerts = parseExtraCACertificatesContent(
        extraCert,
        tls,
        extraCertsPath,
      )
      if (parsedExtraCerts !== undefined) {
        certs.push(parsedExtraCerts)
        logForDebugging(
          `CA certs: Appended extra certificates from NODE_EXTRA_CA_CERTS (${extraCertsPath})`,
        )
      }
    } catch (error) {
      logForDebugging(
        `CA certs: Failed to read NODE_EXTRA_CA_CERTS file (${extraCertsPath}): ${error}`,
        { level: 'error' },
      )
    }
  }

  // Official 2.1.321 (#1931): pre-index bundled roots by SHA-256 so known roots
  // bypass per-certificate X509Certificate parsing during startup filtering.
  let lookupKnownRoot:
    | ((pem: string) => { expires: number } | undefined)
    | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { knownHashes } = require('./mtls.js') as typeof import('./mtls.js')
    knownHashes.registerKnownRoots(tls.rootCertificates)
    lookupKnownRoot = pem => knownHashes.knownRootOf(pem)
  } catch {
    // optional in isolation
  }

  const withoutLoopedCross = filterLoopedCrossCertificates(certs)
  const filtered = filterSelfNamedCertificates(
    withoutLoopedCross,
    tls.rootCertificates,
    parsedExtraCerts,
    process.env,
    lookupKnownRoot,
  )

  return filtered.length > 0 ? filtered : undefined
})

/**
 * Clear the CA certificates cache.
 * Call this when environment variables that affect CA certs may have changed
 * (e.g., NODE_EXTRA_CA_CERTS, NODE_OPTIONS).
 */
export function clearCACertsCache(): void {
  getCACertificates.cache.clear?.()
  warnedExtraCerts.clear()
  logForDebugging('Cleared CA certificates cache')
}
