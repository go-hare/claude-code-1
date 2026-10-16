/**
 * Peel densable 2.1.289 Artifact remaining consent/check/call leftovers.
 */
import { writeFileSync, mkdirSync } from 'fs'
import {
  EXE_289,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-289-helpers.mjs'

const OUT = '/tmp/gold289-artifact'
mkdirSync(OUT, { recursive: true })
const buf = loadSea(EXE_289)

const NEEDLES = [
  '__artifactDeleteTarget',
  '__artifactDeletePin',
  '__artifactAssetUploadPin',
  '__artifactAssetTargetPin',
  '__artifactReadTargetPin',
  '__artifactConsentPin',
  '__artifactPublishTarget',
  '__artifactRoomSendTarget',
  '__artifactSyncTargetPin',
  '__deleteConfirm',
  'Claude wants to permanently delete',
  'Claude wants to upload an asset',
  'Claude wants to read ',
  'Claude wants to watch',
  'Claude wants to reply',
  'Claude wants to resolve',
  'Claude wants to send a live',
  'action "delete"',
  'upload_asset',
  'delete_asset',
  'list_assets',
  'read_asset',
  'list_files',
  'read_file',
  'live-edit',
  'room_send',
  'already approved this session',
  'covers further uploads',
  'each such upload asks again',
  'belongs to someone else, and only its owner can delete',
  'There is no Artifact at',
  'Couldn\'t confirm that the Artifact',
  'Artifact deletes require live human confirmation',
  'mutates published asset storage',
  'Standing-job consent',
  'Already watching this artifact',
  'Re-watching a stop-latched',
  'local session teardown',
  'Notification-triggered comments',
  'Notification-triggered diagnostics',
  'visible to viewers',
  'its content enters this conversation',
  'mapToolResult',
]

const summary = []
for (const needle of NEEDLES) {
  const hits = allHits(buf, needle)
  summary.push({ needle, count: hits.length, hits: hits.slice(0, 12) })
  console.log(`${needle}\t${hits.length}\t${hits.slice(0, 8).join(',')}`)
}

writeFileSync(
  `${OUT}/needles.json`,
  JSON.stringify(summary, null, 2),
)

function dumpHit(tag, hit, before = 800, after = 2500) {
  const ctx = asciiSlice(buf, hit - before, hit + after)
  writeFileSync(`${OUT}/${tag}@${hit}.ctx.txt`, ctx)
  const { i, name } = lastFnStartGeneric(buf, hit, 30000)
  if (i >= 0) {
    const body = extractFnAt(buf, i, 80000)
    if (body.body) {
      writeFileSync(`${OUT}/${tag}@${hit}.${name || 'fn'}.js`, body.body)
      console.log(`  fn ${name}@${i} len=${body.len} sha=${body.sha}`)
      return { hit, name, i, len: body.len, sha: body.sha }
    }
  }
  return { hit, ctxOnly: true }
}

// Deep dumps for pin + delete/upload copy
const deep = [
  '__artifactDeleteTarget',
  '__artifactDeletePin',
  '__artifactAssetUploadPin',
  'Claude wants to permanently delete',
  'Claude wants to upload an asset',
  'covers further uploads',
]
for (const needle of deep) {
  const hits = allHits(buf, needle)
  for (const hit of hits.slice(0, 4)) {
    console.log(`dump ${needle} @${hit}`)
    dumpHit(needle.replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 40), hit)
  }
}

console.log('wrote', OUT)
