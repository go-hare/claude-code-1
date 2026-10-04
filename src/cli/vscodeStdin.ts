/**
 * densable 2.1.283 `C` — bounded stdin read for hidden VS Code host commands.
 * Gold: 191872900. Returns null when the byte cap is exceeded.
 */
export async function readStdinUpTo(maxBytes: number): Promise<string | null> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = Bun.stdin.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export const VSCODE_CHILD_SESSION_REFUSAL =
  'This setting cannot be changed from an editor started inside a Claude Code session. Start the editor outside the session and try again.'
