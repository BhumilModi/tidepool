const pad = (n: number) => String(n).padStart(2, '0')

export function fmtTurn(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.floor(ms / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
}

// A turn's receipt: what it opened and changed, counted by kind, from its rail rows (hooks/rail.ts railRows).
// The plan's own tools are not work and are left out.
const PLAN_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TodoWrite'])

export type ReceiptPart = { key: string; text: string }

type Row = { tool: string; target: string; failed?: boolean }

// An MCP server's short name: `mcp__claude_ai_Linear__save_issue` reads `Linear`.
function mcpServer(tool: string): string | undefined {
  const m = /^mcp__(.+?)__/.exec(tool)
  return m ? m[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ') : undefined
}

// Which receipt part a row counts toward; undefined for the plan's own tools.
export function receiptKey(tool: string): string | undefined {
  if (PLAN_TOOLS.has(tool)) return undefined
  switch (tool) {
    case 'WebFetch': return 'pages'
    case 'WebSearch': return 'searches'
    case 'Read': case 'Grep': case 'Glob': return 'read'
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return 'edited'
    case 'Bash': return 'shell'
    case 'Agent': return 'agents'
  }
  const server = mcpServer(tool)
  return server ? `mcp:${server}` : 'other'
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function receipt(rows: readonly Row[]): ReceiptPart[] {
  const hosts: string[] = []
  const reads = new Set<string>()
  const edits = new Set<string>()
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = receiptKey(r.tool)
    // A failed call opened or changed nothing; the error count says it failed.
    if (key === undefined || r.failed) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (key === 'pages' && r.target && !hosts.includes(r.target)) hosts.push(r.target)
    // Files count once each. A Grep or Glob, or an edit with no path, is a read or edit of its own: a unique entry.
    const own = `${r.tool}#${counts.get(key)}`
    if (key === 'read') reads.add(r.tool === 'Read' && r.target ? r.target : own)
    if (key === 'edited') edits.add(r.target || own)
  }
  const n = (key: string) => counts.get(key) ?? 0
  const parts: ReceiptPart[] = []
  if (n('pages')) {
    const shown = hosts.slice(0, 2).join(', ') + (hosts.length > 2 ? ` +${hosts.length - 2}` : '')
    parts.push({ key: 'pages', text: `${plural(n('pages'), 'page', 'pages')}${shown ? ` (${shown})` : ''}` })
  }
  if (n('searches')) parts.push({ key: 'searches', text: plural(n('searches'), 'search', 'searches') })
  if (reads.size) parts.push({ key: 'read', text: `${reads.size} read` })
  if (edits.size) parts.push({ key: 'edited', text: `${edits.size} edited` })
  if (n('shell')) parts.push({ key: 'shell', text: `${n('shell')} shell` })
  if (n('agents')) parts.push({ key: 'agents', text: plural(n('agents'), 'agent', 'agents') })
  for (const [key, count] of counts) if (key.startsWith('mcp:')) parts.push({ key, text: count === 1 ? key.slice(4) : `${key.slice(4)} ×${count}` })
  if (n('other')) parts.push({ key: 'other', text: `${n('other')} other` })
  return parts
}

// The receipt as one line within `width` cells: parts drop from the end, `always` (the duration) is kept.
export function receiptLine(parts: readonly ReceiptPart[], always: string, width: number): string {
  for (let keep = parts.length; keep >= 0; keep--) {
    const line = [...parts.slice(0, keep).map(p => p.text), always].join(' · ')
    if (line.length <= width) return line
  }
  return always
}
