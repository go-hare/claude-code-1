import type { MemoryFileInfo } from './claudemd.js'
import type { MemoryType } from './memory/types.js'

export type InstructionKind =
  | 'managed'
  | 'user'
  | 'project'
  | 'local'
  | 'memory'

export type InstructionFile = {
  path: string
  kind: InstructionKind
  content: string
  parent?: string
}

export function instructionKindOf(type: MemoryType): InstructionKind {
  switch (type) {
    case 'Managed':
      return 'managed'
    case 'User':
      return 'user'
    case 'Project':
      return 'project'
    case 'Local':
      return 'local'
    default:
      return 'memory'
  }
}

export function memoryTypeOf(kind: InstructionKind): MemoryType {
  switch (kind) {
    case 'managed':
      return 'Managed'
    case 'user':
      return 'User'
    case 'project':
      return 'Project'
    case 'local':
      return 'Local'
    case 'memory':
      return 'AutoMem'
  }
}

export function instructionFileOf(file: MemoryFileInfo): InstructionFile {
  return {
    path: file.path,
    kind: instructionKindOf(file.type),
    content: file.content,
    ...(file.parent !== undefined && { parent: file.parent }),
  }
}

export function memoryFileOf(
  file: InstructionFile,
  previous: readonly MemoryFileInfo[],
): MemoryFileInfo {
  const match = previous.find(
    item =>
      item.path === file.path && instructionKindOf(item.type) === file.kind,
  )
  if (match) {
    return {
      ...match,
      content: file.content,
      ...(file.parent !== undefined ? { parent: file.parent } : {}),
    }
  }
  return {
    path: file.path,
    type: memoryTypeOf(file.kind),
    content: file.content,
    ...(file.parent !== undefined && { parent: file.parent }),
  }
}
