import { chmodSync, closeSync, fsyncSync, openSync, writeSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import {
  SECURE_STORAGE_READ_FAILED,
  type ReadAsyncStrictOptions,
  type SecureStorage,
  type SecureStorageData,
  type SecureStorageReadFailed,
} from './types.js'

function getStoragePath(): { storageDir: string; storagePath: string } {
  const storageDir = getClaudeConfigHomeDir()
  const storageFileName = '.credentials.json'
  return { storageDir, storagePath: join(storageDir, storageFileName) }
}

export const plainTextStorage = {
  name: 'plaintext',
  read(): SecureStorageData | null {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      const data = getFsImplementation().readFileSync(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
  async readAsync(): Promise<SecureStorageData | null> {
    const { storagePath } = getStoragePath()
    try {
      const data = await getFsImplementation().readFile(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch {
      return null
    }
  },
  async readAsyncStrict(
    _key?: unknown,
    options?: ReadAsyncStrictOptions,
  ): Promise<SecureStorageData | null | SecureStorageReadFailed> {
    const { storagePath } = getStoragePath()
    try {
      const data = await getFsImplementation().readFile(storagePath, {
        encoding: 'utf8',
      })
      return jsonParse(data)
    } catch (e: unknown) {
      if (getErrnoCode(e) === 'ENOENT') {
        return null
      }
      return options?.unreadableFileAs === 'failure'
        ? SECURE_STORAGE_READ_FAILED
        : null
    }
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    // sync IO: called from sync context (SecureStorage interface)
    const { storageDir, storagePath } = getStoragePath()
    const fs = getFsImplementation()
    const tempPath = `${storagePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`
    try {
      try {
        fs.mkdirSync(storageDir)
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'EEXIST') {
          throw e
        }
      }

      // Atomic write (#1655): write to temp file, fsync (forgiving EBADF on NFS),
      // then rename over storagePath so ENOSPC/EDQUOT never truncates .credentials.json.
      const payload = jsonStringify(data)
      const fd = openSync(tempPath, 'w', 0o600)
      try {
        writeSync(fd, payload, 0, 'utf8')
        try {
          fsyncSync(fd)
        } catch (syncErr: unknown) {
          if (getErrnoCode(syncErr) !== 'EBADF') {
            throw syncErr
          }
        }
      } finally {
        closeSync(fd)
      }
      chmodSync(tempPath, 0o600)
      fs.renameSync(tempPath, storagePath)
      chmodSync(storagePath, 0o600)
      return {
        success: true,
        warning: 'Warning: Storing credentials in plaintext.',
      }
    } catch {
      try {
        fs.unlinkSync(tempPath)
      } catch {
        // Ignore cleanup failure on temp file
      }
      return { success: false }
    }
  },
  delete(): boolean {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      getFsImplementation().unlinkSync(storagePath)
      return true
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return true
      }
      return false
    }
  },
} satisfies SecureStorage
