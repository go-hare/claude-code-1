/**
 * Type declarations for internal Anthropic packages that cannot be installed
 * from public npm. All exports are typed as `any` to suppress errors while
 * still allowing IDE navigation for the actual source code.
 */

// ============================================================================
// bun:bundle — compile-time macros
// ============================================================================
declare module 'bun:bundle' {
  export function feature(name: string): boolean
}

declare module 'bun:ffi' {
  export const FFIType: {
    bool: string
    ptr: string
    pointer: string
    cstring: string
    i8: string
    i16: string
    i32: string
    i64: string
    u8: string
    u16: string
    u32: string
    u64: string
    f32: string
    f64: string
    void: string
    buffer: string
  }
  export function dlopen<
    T extends Record<string, { args: readonly string[]; returns: string }>,
  >(
    path: string,
    symbols: T,
  ): {
    symbols: { [K in keyof T]: (...args: unknown[]) => unknown }
    close(): void
  }
  export function ptr(buffer: Buffer | ArrayBuffer | Uint8Array): number
  export function toBuffer(ptr: unknown, offset: number, length: number): Buffer
  export function toArrayBuffer(
    ptr: unknown,
    offset: number,
    length: number,
  ): ArrayBuffer
  export class CString {
    constructor(ptr: number, offset?: number, length?: number)
    toString(): string
  }
}

// Third-party modules without @types packages
declare module 'bidi-js' {
  function getEmbeddingLevels(
    text: string,
    defaultDirection?: string,
  ): { paragraphLevel: number; levels: Uint8Array }
  function getReorderSegments(
    text: string,
    embeddingLevels: { paragraphLevel: number; levels: Uint8Array },
    start?: number,
    end?: number,
  ): [number, number][]
  function getVisualOrder(reorderSegments: [number, number][]): number[]
  export { getEmbeddingLevels, getReorderSegments, getVisualOrder }
  export default { getEmbeddingLevels, getReorderSegments, getVisualOrder }
}

declare module 'asciichart' {
  function plot(
    series: number[] | number[][],
    config?: Record<string, unknown>,
  ): string
  export { plot }
  export default { plot }
}

declare module '@napi-rs/keyring' {
  export class Entry {
    constructor(service: string, account: string)
    getPassword(): string | null
    setPassword(password: string): void
    deletePassword(): boolean
  }
}
