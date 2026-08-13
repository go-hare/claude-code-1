/**
 * densable 2.1.229 #7 — safe tool_use input field extraction.
 *
 * SEA gold (`nst` / `CIr` / `AIr`):
 *   function nst(e){if(typeof e!=="object"||e===null)return{};
 *     let{file_path:t,path:r,pattern:n,glob:o,command:i,query:s,content:a}=e;
 *     return{...CIr(t)&&{file_path:t},...CIr(r)&&{path:r},...CIr(n)&&{pattern:n},
 *       ...CIr(o)&&{glob:o},...CIr(i)&&{command:i},...CIr(s)&&{query:s},
 *       ...typeof a==="string"&&{content:a}}}
 *   function CIr(e){return typeof e==="string"&&!e.includes("\x00")}
 *   function AIr(e){return e.file_path??e.path}
 *
 * Resume / malformed tool_use can carry non-string `glob` / `file_path` / `command`.
 * Path helpers (path.normalize, string.includes, getDisplayPath) throw on non-strings —
 * this gate drops unsafe fields before use.
 */

/** densable CIr — path-like tool fields must be clean strings. */
export function isSafeToolInputString(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0')
}

/**
 * densable nst — only keep known string tool-input fields that are safe to
 * pass to path / display / memory-detection helpers.
 */
export type SafeToolInputFields = {
  file_path?: string
  path?: string
  pattern?: string
  glob?: string
  command?: string
  query?: string
  content?: string
}

export function extractSafeToolInputFields(
  input: unknown,
): SafeToolInputFields {
  if (typeof input !== 'object' || input === null) {
    return {}
  }
  const {
    file_path: filePath,
    path,
    pattern,
    glob,
    command,
    query,
    content,
  } = input as Record<string, unknown>
  return {
    ...(isSafeToolInputString(filePath) && { file_path: filePath }),
    ...(isSafeToolInputString(path) && { path }),
    ...(isSafeToolInputString(pattern) && { pattern }),
    ...(isSafeToolInputString(glob) && { glob }),
    ...(isSafeToolInputString(command) && { command }),
    ...(isSafeToolInputString(query) && { query }),
    ...(typeof content === 'string' && { content }),
  }
}

/**
 * densable AIr — primary file path from fields already sanitized by nst.
 * Prefer `getSafeToolFilePathFromRaw` when the input is untrusted tool_use.input.
 */
export function getSafeToolFilePath(
  fields: SafeToolInputFields,
): string | undefined {
  return fields.file_path ?? fields.path
}

/** Convenience: nst + AIr on raw tool input. */
export function getSafeToolFilePathFromRaw(input: unknown): string | undefined {
  return getSafeToolFilePath(extractSafeToolInputFields(input))
}
