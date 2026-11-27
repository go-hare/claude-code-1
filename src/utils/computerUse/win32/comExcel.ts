/**
 * Excel COM automation via PowerShell.
 * Completely headless — Visible=false, no window, no user impact.
 * Each operation opens and closes Excel to avoid orphaned processes.
 */

import { spawnSync } from 'node:child_process'
import { escapePowerShellSingleQuoted } from './uiAutomation.js'

export interface CellInfo {
  row: number
  col: number
  value: string | number | null
  formula?: string
}

export interface SheetInfo {
  name: string
  usedRange: { rows: number; cols: number }
  cells: CellInfo[]
}

export interface ExcelInfo {
  sheets: SheetInfo[]
  sheetNames: string[]
}

const COM_EXCEL_MAX_BUFFER = 32 * 1024 * 1024

function ps(script: string): string {
  // P1-E6(c): Pass UTF-16LE -EncodedCommand so Unicode quotes/paths cannot break parsing.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: COM_EXCEL_MAX_BUFFER,
      windowsHide: true,
    },
  )
  const stderr = result.stderr ? result.stderr.toString('utf8').trim() : ''
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      stderr
        ? `PowerShell error: ${stderr}`
        : `PowerShell exited with status ${result.status}`,
    )
  }
  return result.stdout ? result.stdout.toString('utf8').trim() : ''
}

function escPath(p: string): string {
  return escapePowerShellSingleQuoted(p)
}

function resolveSheet(varName: string, sheet: string | number): string {
  if (typeof sheet === 'number') {
    return `$${varName} = $wb.Sheets.Item(${sheet})`
  }
  return `$${varName} = $wb.Sheets.Item('${escapePowerShellSingleQuoted(sheet)}')`
}

const EXCEL_INIT = `
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
`.trim()

function excelCleanup(hasWorkbook = true): string {
  const parts: string[] = []
  if (hasWorkbook) parts.push('if ($wb) { $wb.Close($false) }')
  parts.push('$excel.Quit()')
  parts.push(
    '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null',
  )
  return parts.join('\n    ')
}

/**
 * Open and read an Excel workbook.
 * Limits to first 1000 non-empty cells per sheet.
 */
export function openExcel(filePath: string): ExcelInfo {
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    $result = @{ sheets = @(); sheetNames = @() }
    foreach ($sheet in $wb.Sheets) {
        $result.sheetNames += $sheet.Name
        $ur = $sheet.UsedRange
        $rows = $ur.Rows.Count
        $cols = $ur.Columns.Count
        $cells = @()
        $count = 0
        for ($r = 1; $r -le $rows -and $count -lt 1000; $r++) {
            for ($c = 1; $c -le $cols -and $count -lt 1000; $c++) {
                $cell = $sheet.Cells.Item($r, $c)
                $val = $cell.Value2
                if ($null -ne $val) {
                    $f = $null
                    if ($cell.HasFormula) { $f = $cell.Formula }
                    $entry = @{ row = $r; col = $c; value = $val }
                    if ($f) { $entry.formula = $f }
                    $cells += $entry
                    $count++
                }
            }
        }
        $result.sheets += @{
            name = $sheet.Name
            usedRange = @{ rows = $rows; cols = $cols }
            cells = $cells
        }
    }
    $result | ConvertTo-Json -Depth 5 -Compress
} finally {
    ${excelCleanup()}
}
`
  const raw = ps(script)
  if (!raw) throw new Error('No output from openExcel')
  type RawSheetInfo = {
    name: string
    usedRange: { rows: number; cols: number }
    cells?: CellInfo | CellInfo[] | null
  }
  const parsed = JSON.parse(raw) as {
    sheets: RawSheetInfo | RawSheetInfo[]
    sheetNames: string | string[]
  }

  // Normalize: PowerShell single-element arrays become objects
  const sheets: RawSheetInfo[] = Array.isArray(parsed.sheets)
    ? parsed.sheets
    : [parsed.sheets]
  const sheetNames: string[] = Array.isArray(parsed.sheetNames)
    ? parsed.sheetNames
    : [parsed.sheetNames]

  return {
    sheets: sheets.map(s => ({
      name: s.name,
      usedRange: s.usedRange,
      cells: Array.isArray(s.cells) ? s.cells : s.cells ? [s.cells] : [],
    })),
    sheetNames,
  }
}

/**
 * Read a single cell value.
 */
export function readCell(
  filePath: string,
  sheet: string | number,
  row: number,
  col: number,
): string | number | null {
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    ${resolveSheet('sheet', sheet)}
    $val = $sheet.Cells.Item(${row}, ${col}).Value2
    if ($null -eq $val) { Write-Output 'null' } else { Write-Output ($val | ConvertTo-Json -Compress) }
} finally {
    ${excelCleanup()}
}
`
  const raw = ps(script)
  if (raw === 'null' || raw === '') return null
  return JSON.parse(raw)
}

/**
 * Read a rectangular range of cells as a 2D array.
 */
export function readRange(
  filePath: string,
  sheet: string | number,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): (string | number | null)[][] {
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    ${resolveSheet('sheet', sheet)}
    $rows = @()
    for ($r = ${startRow}; $r -le ${endRow}; $r++) {
        $row = @()
        for ($c = ${startCol}; $c -le ${endCol}; $c++) {
            $val = $sheet.Cells.Item($r, $c).Value2
            $row += if ($null -eq $val) { '__NULL__' } else { $val }
        }
        $rows += ,@($row)
    }
    $rows | ConvertTo-Json -Depth 3 -Compress
} finally {
    ${excelCleanup()}
}
`
  const raw = ps(script)
  if (!raw) return []
  type RawCellValue = string | number | null
  const parsed = JSON.parse(raw) as RawCellValue[] | RawCellValue[][]
  // Normalize single-row case
  const rows: RawCellValue[][] = Array.isArray(parsed[0])
    ? (parsed as RawCellValue[][])
    : [parsed as RawCellValue[]]
  return rows.map(row => row.map(v => (v === '__NULL__' ? null : v)))
}

/**
 * Write a single cell value.
 */
export function writeCell(
  filePath: string,
  sheet: string | number,
  row: number,
  col: number,
  value: string | number,
): boolean {
  const jsonVal = JSON.stringify(value)
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    ${resolveSheet('sheet', sheet)}
    $sheet.Cells.Item(${row}, ${col}).Value2 = (ConvertFrom-Json '${escapePowerShellSingleQuoted(jsonVal)}')
    $wb.Save()
    Write-Output 'true'
} finally {
    ${excelCleanup()}
}
`
  return ps(script) === 'true'
}

/**
 * Write a 2D array of values starting at (startRow, startCol).
 */
export function writeRange(
  filePath: string,
  sheet: string | number,
  startRow: number,
  startCol: number,
  data: (string | number | null)[][],
): boolean {
  const jsonData = escapePowerShellSingleQuoted(JSON.stringify(data))
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    ${resolveSheet('sheet', sheet)}
    $data = ConvertFrom-Json '${jsonData}'
    for ($r = 0; $r -lt $data.Count; $r++) {
        $row = $data[$r]
        for ($c = 0; $c -lt $row.Count; $c++) {
            $val = $row[$c]
            if ($null -ne $val) {
                if ($val -is [int] -or $val -is [long] -or $val -is [double] -or $val -is [decimal]) {
                    $sheet.Cells.Item(${startRow} + $r, ${startCol} + $c).Value2 = [double]$val
                } else {
                    $sheet.Cells.Item(${startRow} + $r, ${startCol} + $c).Value2 = [string]$val
                }
            }
        }
    }
    $wb.Save()
    Write-Output 'true'
} finally {
    ${excelCleanup()}
}
`
  return ps(script) === 'true'
}

/**
 * Set a formula on a cell.
 */
export function setFormula(
  filePath: string,
  sheet: string | number,
  row: number,
  col: number,
  formula: string,
): boolean {
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    ${resolveSheet('sheet', sheet)}
    $sheet.Cells.Item(${row}, ${col}).Formula = '${escapePowerShellSingleQuoted(formula)}'
    $wb.Save()
    Write-Output 'true'
} finally {
    ${excelCleanup()}
}
`
  return ps(script) === 'true'
}

/**
 * Save workbook. If savePath is given, SaveAs to that path; otherwise Save in place.
 */
export function saveExcel(filePath: string, savePath?: string): boolean {
  const saveCmd = savePath ? `$wb.SaveAs('${escPath(savePath)}')` : '$wb.Save()'
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Open('${escPath(filePath)}')
    ${saveCmd}
    Write-Output 'true'
} finally {
    ${excelCleanup()}
}
`
  return ps(script) === 'true'
}

/**
 * Create a new empty workbook and save it to the given path.
 */
export function createExcel(savePath: string): boolean {
  const script = `
${EXCEL_INIT}
try {
    $wb = $excel.Workbooks.Add()
    $wb.SaveAs('${escPath(savePath)}')
    Write-Output 'true'
} finally {
    ${excelCleanup()}
}
`
  return ps(script) === 'true'
}

/**
 * closeExcel is a no-op since each operation opens and closes its own COM instance.
 */
export function closeExcel(_filePath: string): void {
  // No-op: each function manages its own Excel lifecycle
}
