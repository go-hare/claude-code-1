/**
 * Artifact tool input schema. Gold `tT()` is one flat object with optional
 * fields and no checkPermissions stamps (eH / Wu / Tat). Pins are stamped on
 * updatedInput, not declared here.
 */
import { z } from 'zod/v4'
import {
  ARTIFACT_PUBLISHED_PATH_MAX_CHARS,
  ARTIFACT_READ_FILE_MAX_PATHS,
} from 'src/services/artifactAutoReact/outDirPaths.js'
import { lazySchema } from 'src/utils/lazySchema.js'

/** Hosted actions only — gold `Ue()` also gates official-only verbs we skip. */
const HOSTED_ARTIFACT_ACTIONS = [
  'list',
  'read',
  'comments',
  'reply',
  'resolve',
  'live-edit',
  'watch',
  'unwatch',
  'status',
  'list_assets',
  'upload_asset',
  'delete_asset',
  'list_files',
  'read_file',
  'read_asset',
  'verify',
  'read_page_data',
  'delete',
  'room_send',
  'quickstart',
] as const

export const inputSchema = lazySchema(() =>
  z.object({
    action: z.enum(HOSTED_ARTIFACT_ACTIONS).optional(),
    file_path: z
      .string()
      .optional()
      .describe(
        'Absolute path to a local HTML (.html/.htm) or Markdown (.md/.markdown) file to upload. Markdown is converted to styled HTML before upload.',
      ),
    file_paths: z
      .array(z.string())
      .optional()
      .describe(
        "upload_asset: several local image, video, PDF, font, stylesheet or script files in place of `file_path`; one approval covers the call, and the result lists each file's id and url, or why it was not uploaded.",
      ),
    hash: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/, 'must match ^[A-Za-z0-9_-]{1,128}$')
      .optional()
      .describe(
        'If provided, overwrites the existing artifact with this hash (URL stays stable). If omitted, a new random id is generated.',
      ),
    ttl: z
      .union([z.literal(7), z.literal(30)])
      .optional()
      .describe('Lifetime in days. Must be 7 or 30. Default 7.'),
    limit: z.number().int().min(1).max(200).optional(),
    scope: z.enum(['mine', 'shared', 'all']).optional(),
    url: z
      .string()
      .optional()
      .describe('Published artifact viewer or frame URL.'),
    prompt: z.string().optional(),
    thread_id: z.string().optional().describe('Comment thread id to reply on.'),
    text: z
      .string()
      .optional()
      .describe('Reply text to publish on the thread.'),
    answers_summon: z.boolean().optional(),
    continues_reply_id: z.string().optional(),
    html: z.string().optional().describe('Full HTML document to publish.'),
    after: z.string().optional(),
    asset_id: z.string().optional(),
    path: z
      .string()
      .optional()
      .describe(
        `read_file only: the file's published path inside the artifact, exactly as list_files printed it; "index.html" is the page itself.`,
      ),
    paths: z
      .array(z.string().max(ARTIFACT_PUBLISHED_PATH_MAX_CHARS))
      .min(1)
      .max(ARTIFACT_READ_FILE_MAX_PATHS)
      .optional()
      .describe(
        `read_file: several published paths in place of \`path\`, up to ${ARTIFACT_READ_FILE_MAX_PATHS} in one call; each file is saved as a single \`path\` would be, and the result lists where each one landed, or why it could not be read, with small text files' contents included while they fit.`,
      ),
    out_dir: z
      .string()
      .optional()
      .describe(
        'Local directory to save into (default: artifact-files/<slug>). read_asset: file saved as <asset_id>.<ext>.',
      ),
    schema: z.string().optional(),
    topic: z.string().optional(),
    data: z.unknown().optional(),
    intent: z
      .enum(['document', 'slides', 'design', 'other'])
      .optional()
      .describe(
        "quickstart only (required): what is being made — 'document' (text to read or edit together), 'slides' (a deck or one slide), 'design' (a visual design or prototype on a canvas), 'other' (anything else, or unsure).",
      ),
    design_systems: z
      .boolean()
      .optional()
      .describe(
        "quickstart only: false when a design system's link is already in hand (it is then read with its own call) or one was declined. Omitted or true, the result lists the design systems (not for a document) and, for slides or a design, attaches the default one's README.",
      ),
  }),
)

export type InputSchema = ReturnType<typeof inputSchema>
export type ArtifactInput = z.infer<InputSchema>
