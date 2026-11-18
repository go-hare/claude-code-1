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
import { shouldOfferPublishEdits } from './quickstartRules.js'

/** Official `Qxo` — max inline `edits` pairs per publish call. */
export const ARTIFACT_PUBLISH_EDITS_MAX = 64

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
    force: z
      .boolean()
      .optional()
      .describe(
        'publish: a last-resort overwrite that **discards** the newer published version. On a conflict, Claude merges its changes onto the newer content that the rejection hands it and publishes again. Claude passes true only when the person explicitly said to discard that specific version, and the server may still refuse it over a version saved from inside the page.',
      ),
    overwrite_unread: z
      .array(z.string().min(1).max(512))
      .max(256)
      .optional()
      .describe(
        'publish with `files` or `root` to an existing artifact: published paths this call may replace or remove although you have not read or listed them in this session. Every other path the call touches must be one you read by its `path`, saw in a file listing, or published yourself, and must not have changed since — otherwise nothing is sent and the refusal names each path. Name a path here only when the user asked for it to be replaced without looking at what is there; it never excuses a path that changed after you read it.',
      ),
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
    ...(shouldOfferPublishEdits()
      ? {
          edits: z
            .array(
              z.object({
                old_str: z
                  .string()
                  .describe(
                    'Text copied exactly from the file; must occur once.',
                  ),
                new_str: z
                  .string()
                  .describe('Its replacement; empty deletes old_str.'),
              }),
            )
            .min(1)
            .max(ARTIFACT_PUBLISH_EDITS_MAX)
            .optional()
            .describe(
              'publish: small changes to make to the file at `file_path` in this same call, instead of editing the file with Edit and publishing after. Use it on a page (add `url` to update an artifact from another conversation). Each old_str is text copied exactly from the file as it now stands and must occur in it exactly once; new_str takes its place (empty deletes it). The edits apply in order, all or none: the file is published with them and then saved with them on disk, so it stays the source for later changes; on a miss nothing is changed or published, and the result says which edit failed and why.',
            ),
        }
      : {}),
  }),
)

export type InputSchema = ReturnType<typeof inputSchema>
export type ArtifactInput = z.infer<InputSchema>
