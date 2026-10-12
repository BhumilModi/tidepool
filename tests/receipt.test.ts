import { expect, test } from 'claude-code/testing'

import { fmtTurn, receipt, receiptKey, receiptLine } from '../hooks/receipt'

test('fmtTurn', async () => {
  expect(fmtTurn(9911)).toBe('9.9s')
  expect(fmtTurn(63_000)).toBe('1m 03s')
  expect(fmtTurn(3_725_000)).toBe('1h 02m')
})

const row = (tool: string, target = '') => ({ tool, target })

test('receipt counts a mixed turn by kind, in order', async () => {
  const parts = receipt([
    row('WebFetch', 'code.claude.com'), row('WebFetch', 'github.com'), row('WebFetch', 'code.claude.com'),
    row('WebSearch', 'mods'),
    row('Read', 'a.ts'), row('Read', 'a.ts'), row('Read', 'b.ts'), row('Grep', 'foo'),
    row('Edit', 'a.ts'), row('Write', 'a.ts'), row('Edit', 'c.ts'),
    row('Bash', 'tests'), row('Agent', 'explore'),
    row('mcp__claude_ai_Linear__save_issue'), row('mcp__claude_ai_Linear__get_issue'), row('mcp__inspo__recommend'),
    row('TaskCreate', 'x'), row('TodoWrite'), row('AskUserQuestion'),
  ])
  expect(parts.map(p => p.text)).toEqual([
    '3 pages (code.claude.com, github.com)', '1 search', '3 read', '2 edited', '1 shell', '1 agent', 'Linear ×2', 'inspo', '1 other',
  ])
  expect(parts.map(p => p.key)).toContain('mcp:Linear')
})

test('receipt names two hosts, then counts the rest', async () => {
  const [pages] = receipt([row('WebFetch', 'a.com'), row('WebFetch', 'b.com'), row('WebFetch', 'c.com'), row('WebFetch', 'd.com')])
  expect(pages?.text).toBe('4 pages (a.com, b.com +2)')
})

test('a turn of only plan tools has an empty receipt', async () => {
  expect(receipt([row('TaskCreate'), row('TaskUpdate')])).toEqual([])
  expect(receiptKey('TaskUpdate')).toBeUndefined()
  expect(receiptKey('Glob')).toBe('read')
})

test('a failed call opened nothing; an edit with no path still counts', async () => {
  expect(receipt([{ tool: 'Edit', target: 'a.ts', failed: true }, { tool: 'Read', target: 'b.ts' }]).map(p => p.text)).toEqual(['1 read'])
  expect(receipt([row('NotebookEdit'), row('NotebookEdit')]).map(p => p.text)).toEqual(['2 edited'])
})

test('receiptLine drops parts from the end and keeps the duration', async () => {
  const parts = receipt([row('WebSearch'), row('Read', 'a'), row('Bash')])
  expect(receiptLine(parts, '52s', 80)).toBe('1 search · 1 read · 1 shell · 52s')
  expect(receiptLine(parts, '52s', 23)).toBe('1 search · 1 read · 52s')
  expect(receiptLine(parts, '52s', 3)).toBe('52s')
})
