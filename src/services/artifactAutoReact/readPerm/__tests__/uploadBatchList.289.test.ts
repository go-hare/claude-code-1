import { describe, expect, test } from 'bun:test'
// restApis finishes outDirPaths before this file's import cycle can
// read ARTIFACT_ASSET_CONTENT_TYPES during its own initialization.
import 'src/services/artifactAutoReact/restApis.js'
import { uploadBatchListError } from '../uploadBatchList.js'

describe('densable 2.1.289 upload file_paths list (aLe / xl)', () => {
  test('rejects an empty list, a text file, and a duplicate path', () => {
    expect(uploadBatchListError([])).toContain(
      '`file_paths` must be a list of 1 to 25',
    )
    expect(uploadBatchListError(['notes.md'])).toContain('approved on its own')
    expect(uploadBatchListError(['a.png', 'a.png'])).toContain(
      'names the same file as an earlier entry',
    )
    expect(uploadBatchListError(['a.png'])).toBeNull()
  })
})
