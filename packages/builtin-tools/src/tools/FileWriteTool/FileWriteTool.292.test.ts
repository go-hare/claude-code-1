import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { coerceWriteInputRaw, FileWriteTool } from './FileWriteTool.js'
import {
  coerceWebFetchInputRaw,
  WebFetchTool,
} from '../WebFetchTool/WebFetchTool.js'

describe('#256 FileWriteTool and WebFetchTool input coercion', () => {
  test('FileWriteTool.coerceInput repairs path -> file_path, file_text -> content, and drops stray keys', () => {
    const res = FileWriteTool.coerceInput?.({
      path: '/tmp/foo.txt',
      file_text: 'hello',
      description: 'write greeting',
      command: 'create',
    })
    expect(res).not.toBeNull()
    expect(res?.input).toEqual({
      file_path: '/tmp/foo.txt',
      content: 'hello',
    })
    expect(res?.shapeClass).toBe(
      'path,file_text,drop_description,drop_command_create',
    )
    expect(res?.resultNote).toContain('`path` was read as `file_path`.')
    expect(res?.resultNote).toContain('`file_text` was read as `content`.')
  })

  test('coerceWriteInputRaw drops repeated aliases', () => {
    const res = coerceWriteInputRaw({
      file_path: '/tmp/a.txt',
      file: '/tmp/a.txt',
      content: 'body',
      text: 'body',
    })
    expect(res?.input).toEqual({
      file_path: '/tmp/a.txt',
      content: 'body',
    })
    expect(res?.shapeClass).toBe('repeated_file,repeated_text')
    expect(res?.resultNote).toContain('`file` repeated `file_path`')
  })

  test('WebFetchTool.coerceInput drops stray parameters', () => {
    const res = WebFetchTool.coerceInput?.({
      url: 'https://example.com',
      prompt: 'summarize',
      text_content_token_limit: 5000,
      html_extraction_method: 'readability',
      web_fetch_pdf_extract_text: true,
    })
    expect(res).not.toBeNull()
    expect(res?.input).toEqual({
      url: 'https://example.com',
      prompt: 'summarize',
    })
    expect(res?.shapeClass).toBe(
      'drop_text_content_token_limit,drop_html_extraction_method,drop_web_fetch_pdf_extract_text',
    )
    expect(
      coerceWebFetchInputRaw({ url: 'https://example.com', prompt: 'hi' }),
    ).toBeNull()
  })
})

describe('#250 toolExecution coerces input unconditionally before tool.call plugin hooks', () => {
  test('toolExecution.ts does not gate tool.coerceInput behind coerceInputBeforePluginHooks', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/services/tools/toolExecution.ts'),
      'utf8',
    )
    expect(src).not.toContain('coerceInputBeforePluginHooks')
    expect(src).toContain('const rawCoerced = tool.coerceInput')
  })
})
