# Classify #9 update-footer

Status: **PARTIAL**

## densable gold
- Footer success: `Update installed · Restart to apply/update` (+ ✓ variant)
- Failure depth: npm prefix / `claude.exe in use` / `claude doctor` CTAs via `failureHint`
- State: AppState `autoUpdaterResult` (+ `failureHint`, `consecutiveExeLockFailures`)
- Writers: legacy/npm, native, package-manager all write store; 30m poll
- PromptInput selector reads `autoUpdaterResult?.status==="success"`

## local evidence
- HAVE-ish path: `/Users/apple/work-py/hare-code/claude-code-1/src/components/AutoUpdater.tsx`, `NativeAutoUpdater.tsx`, `Notifications.tsx`, `PromptInput.tsx` fullscreen keep-mounted + notification mirror
- Config: `autoUpdates` / `autoUpdatesProtectedForNative` in `src/utils/config.ts`
- Missing densable depth: no AppState `autoUpdaterResult`; no `failureHint` / exe-lock / av_quarantine footer strings; PackageManager lane notify-only (no success write / tengu_pkg_manager_*); no `autoUpdaterEnforcementHours` / `disableAutoUpdates`

## inventBan
false (CLI updater/footer; not VSCode/gateway)