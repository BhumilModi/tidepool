// The prompt dock's frames: the clay crab, the course it runs, and the cells a Raster paints. Pure: the hooks
// own the clock and the repaints. Pixels are half blocks, two to a terminal cell, so a 6-row scene is 12 tall.

import type { Palette } from './palettes.mjs'

import type { DockMode, DockTurn } from '../types'

export type { DockMode, DockTurn }

export type DockView = { kind: 'idle' | 'intro' | 'work' | 'finish' | 'outro'; k: number }

export const INTRO_MS = 900
export const OUTRO_MS = 800
export const FINISH_MS = 2400
export const SCENE_ROWS = 6
export const IDLE_COLS = 14
export const IDLE_ROWS = 3
export const DEFAULT = 0x01000000

// A scene `rows` cells tall: pixels from the top, the ground two pixels above the bottom.
const groundOf = (rows: number) => rows * 2 - 2
const RUN_X = 8
const IDLE_X = 2
const SPEED: Record<DockMode, number> = { requesting: 8, thinking: 18, tool: 34, responding: 28 } // pixels a second

// '#' body, 'o' eye, '.' empty. Run A, run B, airborne.
export const CRAB = [
  ['..#....#..', '.########.', '##o####o##', '.########.', '.#.#..#.#.', '#.#....#.#'],
  ['..#....#..', '.########.', '##o####o##', '.########.', '#.#.##.#.#', '.#......#.'],
  ['.#......#.', '.########.', '##o####o##', '.########.', '..#.##.#..', '..........'],
]
// Landing: one pixel shorter, as if it squashed.
const SQUASH = [CRAB[0]![0]!, ...CRAB[0]!.slice(2)]
const CRAB_W = CRAB[0]![0]!.length
const CRAB_H = CRAB[0]!.length

const OBSTACLES: Record<string, string[]> = {
  cactus: ['.#.', '###', '.#.'],
  tall: ['.#.#', '##.#', '.###', '..#.'],
  double: ['.#..#.', '###.##', '.#..#.'],
  rock: ['.##.', '####'],
  crate: ['###', '#.#', '###'],
}
const AMBIENT = ['cactus', 'tall', 'double', 'rock']
const CLOUD = ['.##..', '#####']

export const rand = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
const hex = (color: string) => parseInt(color.slice(1), 16)
const easeOut = (k: number) => 1 - (1 - k) ** 3
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export function dockView(turn: DockTurn | undefined, now: number): DockView {
  if (!turn) return { kind: 'idle', k: 0 }
  if (turn.endedAt !== undefined) {
    // A finished turn crosses the finish line first; one stopped with Esc hops straight home.
    const finish = turn.aborted ? 0 : FINISH_MS
    const since = now - turn.endedAt
    if (since < finish) return { kind: 'finish', k: Math.max(0, since / finish) }
    return since - finish < OUTRO_MS ? { kind: 'outro', k: Math.max(0, (since - finish) / OUTRO_MS) } : { kind: 'idle', k: 0 }
  }
  const since = now - turn.startedAt
  return since < INTRO_MS ? { kind: 'intro', k: Math.max(0, since / INTRO_MS) } : { kind: 'work', k: 0 }
}

export function modeAt(turn: DockTurn, now: number): DockMode {
  let mode: DockMode = 'requesting'
  for (const p of turn.phases) if (p.at <= now) mode = p.mode
  return mode
}

// Pixels run since the intro ended, each phase at its own speed.
export function travelled(turn: DockTurn, now: number): number {
  const from = turn.startedAt + INTRO_MS
  const until = Math.min(now, turn.endedAt ?? now)
  if (until <= from) return 0
  const marks = [{ mode: 'requesting' as DockMode, at: from }, ...turn.phases.filter(p => p.at > from), { mode: 'requesting' as DockMode, at: until }]
  let d = 0
  for (let i = 0; i < marks.length - 1; i++) {
    const a = Math.max(from, marks[i]!.at)
    const b = Math.min(until, marks[i + 1]!.at)
    const mode = i === 0 ? modeAt(turn, from) : marks[i]!.mode
    if (b > a) d += ((b - a) / 1000) * SPEED[mode]
  }
  return Math.round(d * 1000) / 1000
}

// Seconds spent in each phase so far, for the header.
export function phaseTimes(turn: DockTurn, now: number): Record<'thinking' | 'tool' | 'responding', number> {
  const out = { thinking: 0, tool: 0, responding: 0 }
  const until = Math.min(now, turn.endedAt ?? now)
  turn.phases.forEach((p, i) => {
    const end = Math.min(until, turn.phases[i + 1]?.at ?? until)
    if (p.mode !== 'requesting' && end > p.at) out[p.mode] += (end - p.at) / 1000
  })
  return out
}

type Obstacle = { at: number; shape: string[]; crate: boolean }

const SLOT = 52

// Obstacles between two course positions: one per 52-pixel slot, placed and chosen by the turn's seed, plus the crates.
// Only the window is built, so a long turn costs the same per frame as a short one.
export function course(turn: DockTurn, from: number, to: number): Obstacle[] {
  const items: Obstacle[] = []
  for (let i = Math.max(0, Math.floor((from - 70) / SLOT) - 1); i * SLOT + 70 <= to; i++) {
    const at = 70 + i * SLOT + Math.floor(rand(turn.seed + i + 0.5) * 18)
    items.push({ at, shape: OBSTACLES[AMBIENT[Math.floor(rand(turn.seed + i) * AMBIENT.length)]!]!, crate: false })
  }
  for (const c of turn.calls) {
    const at = (c.dist ?? travelled(turn, c.at)) + 46
    if (at >= from - 10 && at <= to) items.push({ at, shape: OBSTACLES.crate!, crate: true })
  }
  return items
}

// Checkered flag on a pole: 'p' pole, 'k' light square, 'w' dark square.
const FLAG = ['pkwkw', 'pwkwk', 'pkwkw', 'pwkwk', 'p....', 'p....', 'p....', 'p....', 'p....']
// The flag scrolls in and stops just behind the crab once it has run through (the first 60% of the finish).
const FLAG_FROM = RUN_X + 40
const FLAG_TO = RUN_X - 7
const RUN_IN = 0.6

export function flagX(_turn: DockTurn, k: number, _cols: number): number {
  return Math.round(lerp(FLAG_FROM, FLAG_TO, Math.min(1, k / RUN_IN)))
}
// Pixels the ground scrolls during the finish.
const finishScroll = (k: number) => FLAG_FROM - lerp(FLAG_FROM, FLAG_TO, Math.min(1, k / RUN_IN))
// Sparkles around the crab during its victory hops: [dx, dy] from its top-left.
const SPARKS = [[-3, 0], [CRAB_W + 2, 1], [-2, 4], [CRAB_W + 3, 4], [4, -2], [CRAB_W - 2, -2]] as const

export function score(turn: DockTurn): { jumped: number; crates: number; ms: number } {
  const end = turn.endedAt ?? turn.startedAt
  const dist = travelled(turn, end)
  const passed = (o: Obstacle) => o.at + o.shape[0]!.length / 2 <= dist + CRAB_W / 2
  const cleared = course(turn, 0, dist).filter(passed).length
  const crates = turn.crates ?? turn.calls.length
  // Crates trimmed from `calls` were far behind the crab: all cleared.
  return { jumped: cleared + Math.max(0, crates - turn.calls.length), crates, ms: end - turn.startedAt }
}

// Where the crab is, in scene pixels, and which frame it shows.
export function crabBox(
  view: DockView,
  turn: DockTurn,
  now: number,
  obstacles?: Obstacle[],
  rows = SCENE_ROWS,
): { left: number; top: number; bottom: number; frame: string[] } {
  const rest = groundOf(rows) - CRAB_H
  const box = (x: number, top: number, frame: string[]) => ({ left: Math.round(x), top: Math.round(top), bottom: Math.round(top) + frame.length - 1, frame })
  if (view.kind === 'intro') {
    // It leaves the top of the scene and arcs down onto the ground, squashing as it lands.
    const hop = Math.min(1, view.k / 0.8)
    if (hop >= 1) return box(RUN_X, rest + 1, SQUASH)
    return box(lerp(IDLE_X, RUN_X, easeOut(hop)), Math.max(0, lerp(0, rest, hop * hop) - 2 * Math.sin(Math.PI * hop)), CRAB[2]!)
  }
  if (view.kind === 'finish') {
    // Sprint through the flag, then two victory hops on the spot.
    if (view.k < RUN_IN) return box(RUN_X, rest, CRAB[Math.floor(finishScroll(view.k) / 3) % 2]!)
    // A short scene has less sky: the hops shrink to fit it.
    const lift = Math.min(rest, Math.round(3 * Math.abs(Math.sin(2 * Math.PI * ((view.k - RUN_IN) / (1 - RUN_IN))))))
    return box(RUN_X, rest - lift, lift > 0 ? CRAB[2]! : CRAB[0]!)
  }
  if (view.kind === 'outro') {
    const hop = Math.min(1, view.k / 0.7)
    return box(lerp(RUN_X, IDLE_X, easeOut(hop)), Math.max(0, lerp(rest, 0, easeOut(hop)) - 2 * Math.sin(Math.PI * hop)), hop < 1 ? CRAB[2]! : CRAB[0]!)
  }
  const dist = travelled(turn, now)
  const mid = RUN_X + CRAB_W / 2
  let lift = 0
  for (const o of obstacles ?? course(turn, dist - 20, dist + 80)) {
    const w = o.shape[0]!.length
    const x = o.at - dist + RUN_X
    const d = Math.abs(mid - (x + w / 2))
    const reach = w / 2 + 6
    // Peak one pixel over the obstacle, capped so the crab never leaves the scene.
    const peak = Math.min(rest, o.shape.length + 1)
    if (d < reach) lift = Math.max(lift, Math.round(peak * (1 - (d / reach) ** 2)))
  }
  return box(RUN_X, rest - lift, lift > 0 ? CRAB[2]! : CRAB[Math.floor(dist / 3) % 2]!)
}

class Pixels {
  grid: (number | undefined)[][]
  constructor(readonly w: number, readonly h: number) {
    this.grid = Array.from({ length: h }, () => Array<number | undefined>(w).fill(undefined))
  }
  put(x: number, y: number, c: number) {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.grid[y]![x] = c
  }
  sprite(rows: string[], x: number, y: number, body: number, eye: number) {
    rows.forEach((row, dy) => [...row].forEach((p, dx) => p !== '.' && this.put(x + dx, y + dy, p === 'o' ? eye : body)))
  }
  // Two pixel rows per cell: ▀ in the top colour over the bottom colour.
  cells(): Uint32Array {
    const out = new Uint32Array(this.w * (this.h / 2) * 3)
    for (let r = 0; r < this.h / 2; r++) {
      for (let x = 0; x < this.w; x++) {
        const a = this.grid[r * 2]![x], b = this.grid[r * 2 + 1]![x]
        const i = (r * this.w + x) * 3
        if (a !== undefined && b !== undefined) out.set(a === b ? [0x2588, a, DEFAULT] : [0x2580, a, b], i)
        else if (a !== undefined) out.set([0x2580, a, DEFAULT], i)
        else if (b !== undefined) out.set([0x2584, b, DEFAULT], i)
        else out.set([0x20, DEFAULT, DEFAULT], i)
      }
    }
    return out
  }
}

export function sceneCells(view: DockView, turn: DockTurn, now: number, cols: number, p: Palette, rows = SCENE_ROWS): Uint32Array {
  const GROUND_Y = groundOf(rows)
  const px = new Pixels(cols, rows * 2)
  const endDist = travelled(turn, turn.endedAt ?? now)
  const dist =
    view.kind === 'work' ? travelled(turn, now)
    : view.kind === 'finish' ? endDist + finishScroll(view.k)
    : view.kind === 'outro' ? endDist + (turn.aborted ? 0 : finishScroll(1))
    : 0
  // Clouds drift at a third of the speed.
  for (let i = 0; i < 2; i++) {
    const span = cols + 10
    const cx = ((Math.round(i * 37 + 12 - dist / 3) % span) + span) % span - 5
    CLOUD.forEach((row, y) => [...row].forEach((c, x) => c === '#' && px.put(cx + x, y + i, hex(p.seg))))
  }
  for (let x = 0; x < cols; x++) {
    px.put(x, GROUND_Y, hex(p.track))
    if (rand(Math.floor(x + dist)) > 0.82) px.put(x, GROUND_Y + 1, hex(p.segAlt))
  }
  const obstacles = view.kind === 'work' ? course(turn, dist - 20, dist + cols + 10) : []
  if (view.kind === 'work') {
    for (const o of obstacles) {
      const x = Math.round(o.at - dist + RUN_X)
      if (x > cols || x + o.shape[0]!.length < 0) continue
      const c = hex(o.crate ? p.info : p.warn)
      o.shape.forEach((row, y) => [...row].forEach((ch, dx) => ch === '#' && px.put(x + dx, GROUND_Y - o.shape.length + y, c)))
    }
  }
  if (view.kind === 'finish' || (view.kind === 'outro' && !turn.aborted)) {
    const fx = flagX(turn, view.kind === 'finish' ? view.k : 1, cols)
    const colors: Record<string, number> = { p: hex(p.mid), k: hex(p.ink), w: hex(p.segAlt) }
    FLAG.forEach((row, y) => [...row].forEach((c, x) => c !== '.' && px.put(fx + x, GROUND_Y - FLAG.length + y, colors[c]!)))
  }
  const crab = crabBox(view, turn, now, obstacles, rows)
  if (view.kind === 'finish' && view.k >= RUN_IN) {
    const beat = Math.floor((view.k * FINISH_MS) / 150)
    SPARKS.forEach(([dx, dy], i) => (beat + i) % 2 === 0 && px.put(crab.left + dx, crab.top + dy, hex(i % 2 ? p.warn : p.accent)))
  }
  px.sprite(crab.frame, crab.left, crab.top, hex(p.accent), hex(p.onAccent))
  return px.cells()
}

// Idle: the crab standing in a 14×3 cell corner; a blink paints its eyes in the body colour.
export function idleCells(blink: boolean, p: Palette): Uint32Array {
  const px = new Pixels(IDLE_COLS, IDLE_ROWS * 2)
  px.sprite(CRAB[0]!, IDLE_X, 0, hex(p.accent), blink ? hex(p.accent) : hex(p.onAccent))
  return px.cells()
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Raster cells: little-endian u32 triplets [codePoint, fg, bg], as standard padded base64.
export function encodeCells(words: Uint32Array): string {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return out
}

// The band's requestId, recorded when the band draws, so the timer can repaint its Raster.
export const site: { id: string | undefined; cols: number | undefined; rows?: number } = { id: undefined, cols: undefined }

// The rail's plan-done card: a small crab that runs in, does victory hops with sparks, then stands still.
export const DONE_MS = 2400
export const DONE_COLS = 14
export const DONE_ROWS = 4
const DONE_RUN_MS = 700
const DONE_X = 2

export function doneCrabBox(ms: number): { left: number; top: number; frame: string[] } {
  const rest = DONE_ROWS * 2 - CRAB_H
  if (ms < DONE_RUN_MS) {
    const k = ms / DONE_RUN_MS
    const left = Math.round(lerp(-CRAB_W, DONE_X, easeOut(k)))
    return { left, top: rest, frame: CRAB[Math.floor(ms / 90) % 2]! }
  }
  if (ms >= DONE_MS) return { left: DONE_X, top: rest, frame: CRAB[0]! }
  const lift = Math.min(rest, Math.round(rest * Math.abs(Math.sin((2 * Math.PI * (ms - DONE_RUN_MS)) / 850))))
  return { left: DONE_X, top: rest - lift, frame: lift > 0 ? CRAB[2]! : CRAB[0]! }
}

export function doneCrabCells(ms: number, p: Palette): Uint32Array {
  const px = new Pixels(DONE_COLS, DONE_ROWS * 2)
  const crab = doneCrabBox(ms)
  if (ms >= DONE_RUN_MS && ms < DONE_MS) {
    const beat = Math.floor(ms / 150)
    SPARKS.forEach(([dx, dy], i) => (beat + i) % 2 === 0 && px.put(crab.left + dx, crab.top + dy, hex(i % 2 ? p.warn : p.accent)))
  }
  px.sprite(crab.frame, crab.left, crab.top, hex(p.accent), hex(p.onAccent))
  return px.cells()
}
