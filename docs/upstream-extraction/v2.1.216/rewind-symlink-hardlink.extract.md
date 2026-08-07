# densable 2.1.216 — `/rewind` symlink & hardlink skip (1:1)

> **id:** `rewind-symlink` · Changelog #36/#40  
> **Status:** **HAVE**  
> SEA: tVr/z3g ~224661334; Q3g/Z3g ~224666715  
> Deep dig: `DEEP-1TO1.md` · dumps: `runtime-rewind-dest-check.txt`, `rewind-symlink.*`  
> Prefer runtime recovered offsets over polluted `rewind-symlink.clean.txt`.

---

## 1. Product intent (changelog)

> `/rewind` no longer restores or deletes files through symlinks or hard links at tracked paths and reports how many paths it skipped.

---

## 2. densable binary proof

| Needle | Hit | Offset | Notes |
|--------|-----|--------|-------|
| `FileHistory: [Rewind]` | true | 224661334 | rewind success path + skippedLinks |
| `hard link` | true | 89544989 | backup-dir resume copy (NOT rewind skip) |
| `symlink` | true | 224666715 | Q3g destination safety |
| `skipped` | true | 235200976 | MessageSelector / CLI warning |
| `tengu_file_history_rewind` | true | 224661190 | success/failed telemetry |
| `nlink` | true | 224666952 | hard-linked refuse |

---

## 3. Cleaned densable schema / strings

### User-facing

```text
TYn = "the tracked path is (or became) a link or other non-regular file, its directory changed since the checkpoint, or its backup could not be safely read"

MessageSelector: Restored the code, but skipped ${n} file(s): ${TYn}. Skipped files were left untouched — run with --debug for the paths.
CLI --rewind-files: Warning: ${n} tracked path(s) were skipped: ${TYn}. Run with --debug for the paths.
CLI success: Files rewound to state at message ${uuid}
```

### SDK (lrl describe for `skippedLinks`)

Count of tracked files **not** restored/deleted because symlink, hard link, non-regular, parent dir moved since checkpoint, or backup unsafe. **Only real (non-dryRun) rewind** — dryRun never sets field; preview counts ignore link-safety. Absent/0 = no link-safety refusals; other per-file failures are telemetry-only, not counted here.

### Telemetry

- `tengu_file_history_rewind_success` `{ trackedFilesCount, filesChangedCount, skippedLinksCount }`
- `tengu_file_history_rewind_failed` `{ trackedFilesCount, snapshotFound }`
- `tengu_file_history_rewind_restore_file_failed` `{ dryRun }`

### Backup shape delta

`FileHistoryBackup` gains `realParentDir?: string` (realpath of parent at backup create).

### Refuse detail strings (do not invent beyond list)

`destination is a symlink`, `destination is not a regular file`, `destination is hard-linked (nlink=${n})`, path does not resolve (ELOOP|ENOTDIR), parent dangling/moved/not directory, backup not regular / O_NOFOLLOW races, FIFO ENXIO, fd/path identity mismatch, etc.

---

## 4. Cleaned densable runtime

```js
// tVr fileHistoryRewind → applySnapshotWithLinkSafety (z3g)
// always Q3g pre-touch; Z3g restore with O_NOFOLLOW; return { skippedLinks }

async function assertRewindDestinationSafe(destPath, expectedRealParentDir) { // Q3g
  const st = await lstat(destPath);
  if (st.isSymbolicLink()) return refuse('destination is a symlink');
  if (!st.isFile()) return refuse('destination is not a regular file');
  if (st.nlink > 1) return refuse(`destination is hard-linked (nlink=${st.nlink})`);
  // ENOENT allowed; ELOOP/ENOTDIR refuse
  // if expectedRealParentDir: realpath parent / dangling / moved / non-dir
  return { verdict: 'safe' };
}

async function restoreBackupNoFollow(dest, backupName, expectedRealParentDir) { // Z3g
  // open backup O_RDONLY|O_NONBLOCK|O_NOFOLLOW
  // open dest O_WRONLY|O_CREAT|O_NOFOLLOW|O_NONBLOCK
  // post-open: nlink>1, parent drift, fd/path ino/dev mismatch → refused
  // truncate + 64KiB copy; chmod backup mode
  // return 'restored' | 'refused' | 'backup-missing'
}

// skippedLinks counting is NARROW:
// Q3g refuse + delete refuse codes + Z3g refused only
// missing backup / generic errors = telemetry only, NOT skippedLinks

// dryRun fileHistoryGetDiffStats does NOT run Q3g; skippedLinks absent
// createBackup records realParentDir (eVr); rejects non-regular tracked sources
// resume hardlink-then-copy (e4g) is ORTHOGONAL — do not change for this item
```

### Mangled symbols

`tVr`, `z3g`, `Q3g`, `Z3g`, `eVr`, `oRu`, `Ens`, `TYn`, `lrl`, `kst`, …

---

## 5. go-hare land status (post-216 deepen)

| Path | Status |
|------|--------|
| `src/utils/fileHistory.ts` | **HAVE** Q3g + Z3g `restoreBackupNoFollow` + `realParentDir` + return `{filesChanged,skippedLinks}` + telemetry |
| createBackup | **HAVE** captures `realParentDir` via realpath(parent) |
| restore path | **HAVE** O_NOFOLLOW open/copy loop (no copyFile-through-symlink) |
| SDK `RewindFilesResultSchema` | **HAVE** `skippedLinks` + densable lrl describe |
| `handleRewindFiles` | **HAVE** passes `filesChanged` + `skippedLinks` on real rewind; dryRun omits |
| MessageSelector / REPL TYn partial-restore UX | **HAVE** `onRestoreCode` → `{skippedLinks}`; `formatRewindSkippedLinksMessage` + densable error-branch order |
| CLI `--rewind-files` human skip warning | **HAVE** stderr `formatRewindSkippedLinksCliWarning` (TYn); stdout success line clean |

---

## 6. 1:1 implement steps (ordered)

1. Extend `FileHistoryBackup` with `realParentDir?`; capture via resolveRealParentDir (eVr) in createBackup (incl null-backup).
2. Port Q3g `assertRewindDestinationSafe`.
3. Port Z3g `restoreBackupNoFollow` (O_NOFOLLOW, 64KiB loop, exact refuse/log/telemetry).
4. Rewrite applySnapshot as link-safe loop; narrow skippedLinks counting.
5. `fileHistoryRewind` returns `{ skippedLinks }`; success telemetry includes `skippedLinksCount`.
6. Thread skippedLinks through MessageSelector partial-restore UX (TYn).
7. CLI --rewind-files + SDK schemas; dryRun omits skippedLinks and does not run Q3g.
8. Leave resume hardlink-then-copy unchanged.
9. Align createBackup non-regular rejection + noFollow where densable does.
10. Tests (section 7); `bun run precheck`.

---

## 7. Tests

- Symlink at tracked path skipped (not written/unlinked).
- Hardlink nlink>1 skipped.
- Parent replaced by symlink / moved realParentDir skipped.
- O_NOFOLLOW race refused.
- Missing dest still restorable.
- dryRun no skippedLinks.
- Telemetry fields.
- MessageSelector/CLI strings use TYn.
- Missing backup does **not** increment skippedLinks.

Suggested:

- `src/utils/__tests__/fileHistory.rewind-symlink.216.test.ts`
- `src/utils/__tests__/fileHistory.rewind-hardlink.216.test.ts`
- `src/utils/__tests__/fileHistory.rewind-parent-move.216.test.ts`
- `src/cli/__tests__/print.rewind-files-skipped.216.test.ts`
- `src/components/__tests__/MessageSelector.rewind-skipped.216.test.ts`
- `src/entrypoints/sdk/__tests__/rewindFilesResult.skippedLinks.216.test.ts`

---

## 8. Risks / do-not-simplify

- API surface change across REPL, MessageSelector, print, SDK.
- O_NOFOLLOW portability (use `fs.constants.* ?? 0` like densable).
- nlink>1 refuses intentional APFS clones — product behavior per binary.
- Narrow skippedLinks counting — UI must not over-count.
- dryRun may preview restore that later skips — keep lrl wording.
- Old snapshots without realParentDir skip parent-move checks only.
- Do not invent refuse reasons beyond recovered list.
- Do not conflate with resume backup hardlink path or claude-symlink-write (#18).
