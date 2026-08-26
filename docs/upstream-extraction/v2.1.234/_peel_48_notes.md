# densable 2.1.234 #48 — Running tool header elapsed dim

## SEA
- `u5e` = ShellTimeDisplay: all branches `dimColor:!0` for `(elapsed)` / timeout strings
- ShellProgressMessage empty: `Running… ` + u5e

## Local already 1:1
- `ShellTimeDisplay.tsx` `<Text dimColor>`
- `ShellProgressMessage.tsx` Running… + ShellTimeDisplay
