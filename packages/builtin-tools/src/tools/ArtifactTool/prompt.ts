import { shouldOfferPublishEdits } from './quickstartRules.js'

export const ARTIFACT_TOOL_NAME = 'Artifact'

export async function describeArtifactTool(): Promise<string> {
  return 'Work with Claude artifacts: list/read/comments/reply/resolve/live-edit/watch/status/assets/files/verify/delete, or tip cloud-artifacts upload via file_path.'
}

export async function getArtifactToolPrompt(): Promise<string> {
  const publishEditsClause = shouldOfferPublishEdits()
    ? '\n- For a small change to a page published from a file in this conversation, Claude can send the change as `edits` on the publish call itself (old_str/new_str pairs copied exactly from the file as it now stands) instead of editing the file first.'
    : ''
  return `Official Artifact tool (densable name \`Artifact\`).

## Tip cloud-artifacts upload (no action)
- \`file_path\` (required): absolute HTML/Markdown path
- \`hash\` / \`ttl\` optional${publishEditsClause}
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

## Multi-view hash routing
Only a plain \`#name\` passes between the artifact's link and \`location.hash\`, never \`#/path\`, \`#key=value\`, a \`pushState\` path or a query string. The address bar on the artifact's own page and Share's Copy link follow the page's hash; beside a chat, in a project or in an app the bar may not. Only where a page has several views worth bookmarking or sending, route on the hash: name each in ASCII letters, digits and hyphens (never \`settings\`, \`sidebar\`, \`customize\`, \`upgrade\`, \`downloads\` or \`comment-*\`, which claude.ai reserves) and show the one in \`location.hash\`, or the start view if none, on load and on \`hashchange\`. Keep other state in the page, and keys, tokens or private values out of the hash: it shows in history and copied links.

## CDN library pinning
Pin every library URL to an exact version (\`react@18.3.1\` on jsDelivr or unpkg, \`react/18.3.1/…\` on cdnjs, \`cdn.tailwindcss.com/3.4.17\`), never a bare name, a range or a tag (\`react\`, \`react@18\`, \`@latest\`). Choose a version at least two weeks old. Any version you knew before this conversation is old enough; if you look versions up, skip any published in the last two weeks.

Official registration (ASe / cobalt) gates model availability; tip upload also opens when tip hosting env or \`CLAUDE_CODE_ARTIFACT=1\`.`
}
