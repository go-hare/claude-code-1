# densable 2.1.216 — workflow / scheduled writes vs `.claude` symlink (1:1)

> **id:** `claude-symlink-write` · Changelog #18  
> **Status:** **HAVE**  
> SEA: nWr ~224170571; L1a ~234979081; YNn/M6/Fle shared  
> Deep dig: `DEEP-1TO1.md`

---

## 1. Product intent (changelog)

> Fixed workflow saves and scheduled-task writes following a symlink at `.claude`, which could redirect writes outside the project.

---

## 2. densable binary proof

| Needle | Hit | Offset | Notes |
|--------|-----|--------|-------|
| `.claude` | true | 84243072 | scheduled_tasks.json + workflows paths |
| `symlink` | true | 75845968 | SymlinkWriteRefusedError messages |
| `O_NOFOLLOW` | true | 61602376 | YNn/M6 open flags |
| `scheduled` | true | 224170571 | nWr writeCronTasks |
| `workflow` | true | 234979081 | L1a saveDynamicWorkflow |
| `redirect writes` | false | -1 | changelog-only phrase |

---

## 3. Cleaned densable schema / strings

### Error strings (binary)

```text
assertDirChainReal: dir must be strictly inside base (rel: ${rel})
Refusing to write under symlinked or non-directory path: ${path}
Refusing to write into symlinked directory: ${dirname}
Refusing to write through symlink: ${path}. Resolve the symlink and pass the real target path explicitly.
Refusing to write through symlink: ${path} (O_NOFOLLOW)
Refusing to stage atomic write under non-directory parent: ${dir}
Error.name: SymlinkWriteRefusedError
Staging leaf: .cc-writes (under .claude)
Paths: .claude/scheduled_tasks.json, .claude/workflows/<slug>.js
```

### Telemetry

`workflow_save` write_failed / already_exists; `tengu_workflow_saved` `{scope, overwrite, script_size_chars}`

### File shape (unchanged)

CronFile `{ tasks: [...] }` with durable flag stripped on write.

---

## 4. Cleaned densable runtime

```js
class SymlinkWriteRefusedError extends Error { // Fle
  constructor(message) { super(message); this.name = 'SymlinkWriteRefusedError'; }
}

function isClaudeConfigDirPath(p) { // VEt
  // resolve/NFC normalize equality with getClaudeConfigDir() — NOT endsWith('.claude')
}

async function assertDirChainReal(base, dir) { // YNn
  // relative must be strictly inside base
  // for each segment: open(O_RDONLY|O_DIRECTORY|O_NOFOLLOW)
  // ELOOP/ENOTDIR → SymlinkWriteRefusedError under chain
  // ENOENT → return (mkdir later)
}

async function writeFileAndFlush(filePath, data, opts) { // M6
  // opts: encoding, mode, allowSymlink?, checkParentDir?, stagingDir?
  // default O_NOFOLLOW; lstat refuse target symlink unless allowSymlink
  // checkParentDir: open dirname O_DIRECTORY|O_NOFOLLOW
  // temp `.tmp.${pid}.${hex6}` under stagingDir; rename; O_NOFOLLOW fallback
}

async function writeCronTasks(tasks, dir) { // nWr
  const root = dir ?? getProjectRoot();
  const claudeDir = path.join(root, '.claude');
  const needsChainGuard = !isClaudeConfigDirPath(claudeDir);
  if (needsChainGuard) await assertDirChainReal(root, claudeDir);
  await mkdir(claudeDir, { recursive: true });
  await writeFileAndFlush(getCronFilePath(root), body, {
    allowSymlink: !needsChainGuard,
    checkParentDir: needsChainGuard,
    stagingDir: path.join(root, '.claude', '.cc-writes'),
  });
}
// fer/C1e/Dyu all go through nWr
// scheduled_tasks.lock (y7f) still plain writeFile wx — NOT this item

async function saveDynamicWorkflow({ name, scope, script, overwrite, cwd }) { // L1a
  const workflowsDir = resolveWorkflowsDir(scope, cwd); // K4b
  const needsChainGuard = scope !== 'user' && !isClaudeConfigDirPath(path.dirname(workflowsDir));
  if (needsChainGuard) {
    await assertDirChainReal(path.dirname(path.dirname(workflowsDir)), workflowsDir);
  }
  await mkdir(workflowsDir, { recursive: true, mode: 0o700 });
  if (overwrite) {
    await writeFileAndFlush(filePath, script, { mode: 0o600, checkParentDir: needsChainGuard });
  } else {
    await writeFile(filePath, script, { mode: 0o600, flag: 'wx' });
  }
}
```

### Mangled symbols

`VEt`, `Rfl`, `nn`, `YNn`, `Fle`, `M6`, `ckl`, `Bhe`, `nWr`, `tGe`, `e1g`, `L1a`, `K4b`, `f_e`, `Pl`, `Cc`, `RPt`, `APt`

---

## 5. go-hare land (HAVE)

| Path | Status |
|------|--------|
| `src/utils/symlinkWriteGuard.ts` | **HAVE** Fle / ukl / Bhe / VEt / YNn / M6 / ckl |
| `src/utils/claudeDirWriteGuard.ts` | **HAVE** re-export + `ClaudeDirSymlinkEscapeError` alias |
| `src/utils/cronTasks.ts` writeCronTasks | **HAVE** densable nWr option matrix |
| `src/utils/cronTasksLock.ts` | **OUT OF SCOPE** (densable also unguarded) |
| `src/workflow/saveDynamicWorkflow.ts` | **HAVE** L1a/K4b + tengu_workflow_saved |
| `packages/workflow-engine/.../persistInline.ts` | **HAVE** local YNn + leaf/parent O_NOFOLLOW (zero-core-deps) |
| worktree create symlink reject | **ADJACENT** — different item |
| task diskOutput O_NOFOLLOW | **REFERENCE** pattern only |

### Tests

- `src/utils/__tests__/symlinkWriteGuard.216.test.ts` — YNn / M6 / nWr / L1a
- `src/utils/__tests__/claudeDirWriteGuard.216.test.ts` — project `.claude` surface + alias
- `packages/workflow-engine/src/__tests__/persistInline.test.ts` — chain + leaf refuse

---

## 6. 1:1 implement steps (done)

1. Port SymlinkWriteRefusedError + assertDirChainReal (YNn) into `symlinkWriteGuard.ts`.
2. Port writeFileAndFlush (M6) with allowSymlink/checkParentDir/stagingDir; staging leaf `.cc-writes`.
3. isClaudeConfigDirPath (VEt) via getClaudeConfigHomeDir NFC/normalize identity.
4. Rewrite writeCronTasks to nWr option matrix; durable writers only via writeCronTasks.
5. Leave lock file unguarded (y7f).
6. Port saveDynamicWorkflow + resolveWorkflowsDir (L1a/K4b): project chain guard; mkdir 0o700; overwrite M6; create wx 0o600.
7. workflow-engine persistInline: local YNn subset (no `src/` import).
8. Tests (section 5).

---

## 7. Risks / do-not-simplify

- Patching only one call site reintroduces follow-symlink.
- Wrong VEt skips guard on project writes or over-guards config writes.
- Non-overwrite create uses writeFile wx after YNn — TOCTOU remains densable-same; do not invent stronger.
- ckl/S1r staging identity partially recovered — core O_NOFOLLOW refuse is the product bar.
- Windows O_NOFOLLOW/O_DIRECTORY availability — verify rather than assume POSIX-only.
- Do not conflate with rewind-symlink (#36) or worktree create symlink reject.
