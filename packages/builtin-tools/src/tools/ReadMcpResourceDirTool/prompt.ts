/**
 * Official 2.1.331 ReadMcpResourceDirTool prompts — pFl / mFl 1:1.
 */

import { MCP_DIRECTORY_MIME_TYPE } from './constants.js'

/** Official pFl */
export const DESCRIPTION = `
List the direct children of a directory resource on an MCP server.
- server: The name of the MCP server to read from
- uri: The URI of the directory resource

Only usable against a server that has declared support for directory listing. The listing is not recursive.
`

/** Official mFl */
export const PROMPT = `
List the direct children of a directory resource on an MCP server (\`resources/directory/read\`).

Parameters:
- server (required): The name of the MCP server to read from
- uri (required): The URI of the directory resource

The listing is not recursive. Each entry carries its own \`uri\`; subdirectories appear with mimeType "${MCP_DIRECTORY_MIME_TYPE}" — call this tool again on a subdirectory's \`uri\` to descend.

Only usable against a server that has declared support for directory listing; other servers return an error.
`
