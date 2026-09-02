export const ARTIFACT_TOOL_NAME = 'Artifact'

export async function describeArtifactTool(): Promise<string> {
  return 'Work with Claude artifacts: list/read/comments/reply/resolve/live-edit/watch/status/assets/files/verify/delete, or tip cloud-artifacts upload via file_path.'
}

export async function getArtifactToolPrompt(): Promise<string> {
  return `Official Artifact tool (densable name \`Artifact\`).

## Tip cloud-artifacts upload (no action)
- \`file_path\` (required): absolute HTML/Markdown path
- \`hash\` / \`ttl\` optional
Output: \`{ id, url, expiresAt }\`.

## densable actions
- \`list\` — list frames (\`limit\`, \`scope\`)
- \`read\` — read published HTML at \`url\` (optional \`prompt\`)
- \`comments\` — read comment threads at \`url\` (optional \`thread_id\`)
- \`reply\` — post \`text\` on \`thread_id\` at \`url\`
- \`resolve\` — resolve \`thread_id\` at \`url\`
- \`live-edit\` — publish full \`html\` for \`url\` (vf-gated)
- \`watch\` / \`unwatch\` / \`status\` — live comment subscribe control plane
- \`list_assets\` / \`upload_asset\` / \`delete_asset\` — frame assets
- \`list_files\` — list published files
- \`read_file\` — save published \`path\` under \`out_dir\` (AWt → JCm → wx rename)
- \`read_asset\` — save \`asset_id\` under \`out_dir\` as \`<id>.<ext>\` (EWt → TCm → wx rename)
- \`verify\` — diagnostics (mao gate; tip default closed)
- \`read_page_data\` — island schemas (unavailable without registry)
- \`delete\` — permanent delete (confirm pin + schema gate)
- \`room_send\` — live room broadcast (host often unbound)

Official registration (ASe / cobalt) gates model availability; tip upload also opens when tip hosting env or \`CLAUDE_CODE_ARTIFACT=1\`.`
}
