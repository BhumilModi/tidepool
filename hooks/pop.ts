import { rand } from './dock'

// Anemone pop: anemones open in the sand for a moment; pop each before it closes (features/pop-surface.tsx
// draws it in the rail while a turn runs). Pure: holes, timing and drawing, in cells.

export const GAME_ROWS = 7
// The Client's rows: a line for the hint and score, then the pool.
export const GAME_HEIGHT = GAME_ROWS + 1
export const FRAME_MS = 100
// The section stays this long after a turn ends, the round held, then folds away.
export const GAME_LINGER_MS = 3000
// The slash command that turns the game on and off; the choice and the best score are kept in the store.
export const PLAY_COMMAND = 'tidepool-play'
export const GAME_ON_KEY = 'game-on'
export const GAME_BEST_KEY = 'game-best'

const LIVES = 3
const HOLE_W = 5
const SPACING = 11
// Pool rows each hole row starts on: rows 1-2 and 4-5; the sand is the last row.
const ROW_TOP = [1, 4]
// Popped and missed holes flash this long.
const FLASH_MS = 300
// A hole about to close dims this long before.
const CLOSING_MS = 350
const MAX_OPEN = 3

export type GameMode = 'ready' | 'run' | 'paused' | 'over'

export type Hole = { until?: number; flash?: { kind: 'pop' | 'miss'; until: number } }

export type Game = {
  mode: GameMode
  // Play time in ms: it stands still while the round is held, so nothing closes while you are away.
  t: number
  score: number
  lives: number
  // When the next anemone opens.
  next: number
  spawned: number
  seed: number
  holes: Hole[]
}

export type Colors = { open: string; closing: string; eye: string; hole: string; sand: string; pop: string; miss: string; faint: string }
export type Run = { text: string; color?: string }

// Where each hole sits in `cols` cells: two staggered rows, numbered across the first row then the second.
export function layout(cols: number): { x: number; top: number }[] {
  const out: { x: number; top: number }[] = []
  ROW_TOP.forEach((top, row) => {
    for (let x = 2 + row * (SPACING >> 1); x + HOLE_W <= cols - 1; x += SPACING) out.push({ x, top })
  })
  return out.slice(0, 9)
}

export function newGame(seed: number, holes: number): Game {
  return { mode: 'ready', t: 0, score: 0, lives: LIVES, next: 400, spawned: 0, seed, holes: Array.from({ length: holes }, () => ({})) }
}

// Faster as the score climbs: how long an anemone stays open, and the wait before the next.
export const openMs = (score: number) => Math.max(700, 1600 - score * 30)
export const gapMs = (score: number) => Math.max(350, 1000 - score * 22)

const isOpen = (h: Hole, t: number) => h.until !== undefined && h.until > t

// Pops hole `i` (a click on it, or its number key). Starts a ready or held round, or a new one after it ended.
export function pop(g: Game, i: number): Game {
  if (g.mode === 'over') return { ...newGame(g.seed + 1, g.holes.length), mode: 'run' }
  if (g.mode !== 'run') return { ...g, mode: 'run' }
  const h = g.holes[i]
  if (!h || !isOpen(h, g.t)) return g
  const holes = g.holes.map((one, j) => (j === i ? { flash: { kind: 'pop' as const, until: g.t + FLASH_MS } } : one))
  return { ...g, holes, score: g.score + 1 }
}

// The hole under a cell of the pool (`y` counted from the pool's top row), if any.
export function holeAt(cols: number, x: number, y: number): number | undefined {
  const i = layout(cols).findIndex(h => y >= h.top && y < h.top + 2 && x >= h.x - 1 && x <= h.x + HOLE_W)
  return i < 0 ? undefined : i
}

// Advances a running round by `ms`: anemones left open too long cost a life, new ones open.
export function step(g: Game, ms: number): Game {
  if (g.mode !== 'run') return g
  const t = g.t + ms
  let lives = g.lives
  let holes = g.holes.map(h => {
    if (h.until !== undefined && h.until <= t) {
      lives--
      return { flash: { kind: 'miss' as const, until: t + FLASH_MS } }
    }
    return h.flash && h.flash.until <= t ? {} : h
  })
  let { next, spawned } = g
  if (t >= next) {
    const free = holes.map((h, i) => (isOpen(h, t) || h.flash ? -1 : i)).filter(i => i >= 0)
    if (free.length > 0 && holes.filter(h => isOpen(h, t)).length < MAX_OPEN) {
      const i = free[Math.floor(rand(g.seed * 97 + spawned) * free.length)]!
      holes = holes.map((h, j) => (j === i ? { until: t + openMs(g.score) } : h))
      spawned++
    }
    next = t + gapMs(g.score)
  }
  return { ...g, t, lives: Math.max(0, lives), holes, next, spawned, mode: lives <= 0 ? 'over' : 'run' }
}

// The pool, `cols` cells wide and GAME_ROWS tall: runs of text per row, a run per change of colour.
export function draw(g: Game, cols: number, c: Colors): Run[][] {
  const grid = Array.from({ length: GAME_ROWS }, () => Array.from({ length: cols }, () => ({ ch: ' ', color: undefined as string | undefined })))
  const put = (x: number, y: number, s: string, color: string) =>
    [...s].forEach((ch, i) => {
      const cell = grid[y]?.[x + i]
      if (cell && ch !== ' ') Object.assign(cell, { ch, color })
    })
  layout(cols).forEach(({ x, top }, i) => {
    const h = g.holes[i] ?? {}
    if (h.flash?.kind === 'pop') {
      put(x, top, ' ✦ ✦ ', c.pop)
      put(x, top + 1, '  ✦  ', c.pop)
    } else if (h.flash?.kind === 'miss') {
      put(x, top + 1, ' ▁✕▁ ', c.miss)
    } else if (isOpen(h, g.t)) {
      const body = h.until! - g.t <= CLOSING_MS ? c.closing : c.open
      put(x, top, ' ▄█▄ ', body)
      put(x, top + 1, '▐█ █▌', body)
      put(x + 2, top + 1, '◉', c.eye)
    } else {
      put(x, top + 1, ' ▁▁▁ ', c.hole)
      put(x + 2, top + 1, String(i + 1), c.faint)
    }
  })
  put(0, GAME_ROWS - 1, '▀'.repeat(cols), c.sand)
  return grid.map(row => {
    const runs: Run[] = []
    for (const cell of row) {
      const last = runs.at(-1)
      if (last && last.color === cell.color) last.text += cell.ch
      else runs.push({ text: cell.ch, ...(cell.color ? { color: cell.color } : {}) })
    }
    return runs
  })
}
