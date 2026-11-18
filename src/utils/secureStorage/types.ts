// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SecureStorageData = any

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
  update(data: SecureStorageData): SecureStorageUpdateResult
  mutate?(
    key: string,
    fn: (prev: SecureStorageData) => SecureStorageData,
  ): unknown
  delete(): boolean
  invalidateCache?: () => void
}
