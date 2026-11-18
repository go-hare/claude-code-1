// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SecureStorageData = any

export const SECURE_STORAGE_READ_FAILED: unique symbol = Symbol(
  'secureStorage.READ_FAILED',
)
export type SecureStorageReadFailed = typeof SECURE_STORAGE_READ_FAILED

export type ReadAsyncStrictOptions = {
  inaccessibleAs?: 'failure' | 'failureIfTransient'
  unparsableEntryAs?: 'failure'
  unreadableFileAs?: 'failure'
}

export class McpCredentialStoreUnavailableError extends Error {
  readonly code = 'CREDENTIAL_STORE_UNAVAILABLE'
  readonly shortMessage: string

  constructor(
    serverName: string,
    phase: 'before_request' | 'after_request' = 'before_request',
  ) {
    const detail =
      phase === 'before_request'
        ? `Could not read the stored credentials for MCP server "${serverName}", so the request didn't run. ${process.platform === 'darwin' ? "If your Mac's keychain is locked, unlock it, then try again." : 'Try again.'}`
        : `A request to MCP server "${serverName}" was sent without your stored credentials, so the server rejected it. The credentials are available now. Try again.`
    super(detail)
    this.shortMessage =
      phase === 'before_request'
        ? 'MCP credential store could not be read'
        : 'MCP credentials were read only after a request went out without them'
    this.name = 'McpCredentialStoreUnavailableError'
  }
}

export type SecureStorageUpdateResult = {
  success: boolean
  warning?: string
  transient?: boolean
  keychainLocked?: boolean
  exitCode?: number
  fallbackWritten?: boolean
}

export type SecureStorage = {
  name: string
  read(key?: string): SecureStorageData | null
  readAsync(key?: unknown): Promise<SecureStorageData | null>
  readAsyncStrict?(
    key?: unknown,
    options?: ReadAsyncStrictOptions,
  ): Promise<SecureStorageData | null | SecureStorageReadFailed>
  update(data: SecureStorageData): SecureStorageUpdateResult
  mutate?(
    key: string,
    fn: (prev: SecureStorageData) => SecureStorageData,
  ): unknown
  delete(): boolean
  invalidateCache?: () => void
}
