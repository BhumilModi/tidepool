import { expect, test } from 'claude-code/testing'

import { FRAME_MS, GAME_ROWS, draw, gapMs, holeAt, layout, newGame, openMs, pop, step } from '../hooks/pop'
import type { Game } from '../hooks/pop'

const C = { open: '#ff8800', closing: '#aa5500', eye: '#000000', hole: '#444444', sand: '#333333', pop: '#ffcc00', miss: '#ff0000', faint: '#777777' }

const run = (g: Game, ms: number) => {
  for (let t = 0; t < ms; t += FRAME_MS) g = step(g, FRAME_MS)
  return g
}
const openHole = (g: Game) => g.holes.findIndex(h => h.until !== undefined && h.until > g.t)

test('holes sit in two staggered rows that fit the width, numbered 1 up', async () => {
  const holes = layout(44)
  expect(holes.length).toBe(7)
  expect(holes.every(h => h.x >= 0 && h.x + 5 <= 43)).toBe(true)
  expect(new Set(holes.map(h => h.top))).toEqual(new Set([1, 4]))
  expect(layout(200)).toHaveLength(9)
})

test('nothing opens before the first press; a press starts the round', async () => {
  const g = newGame(1, 7)
  expect(run(g, 2000)).toEqual(g)
  expect(pop(g, 0).mode).toBe('run')
})

test('popping an open anemone scores; a closed hole does nothing', async () => {
  let g = run(pop(newGame(1, 7), 0), 500)
  const i = openHole(g)
  expect(i).toBeGreaterThanOrEqual(0)
  const closed = g.holes.findIndex((h, j) => j !== i && h.until === undefined)
  expect(pop(g, closed)).toBe(g)
  g = pop(g, i)
  expect(g.score).toBe(1)
  expect(g.holes[i]?.flash?.kind).toBe('pop')
})

test('an anemone left to close costs a life; three and the round is over, a press starts another', async () => {
  let g = pop(newGame(2, 7), 0)
  g = run(g, 500)
  expect(openHole(g)).toBeGreaterThanOrEqual(0)
  g = run(g, openMs(0) + 100)
  expect(g.lives).toBeLessThan(3)
  g = run(g, 20_000)
  expect(g.mode).toBe('over')
  expect(g.lives).toBe(0)
  const again = pop(g, 0)
  expect([again.mode, again.score, again.lives]).toEqual(['run', 0, 3])
})

test('a held round stands still: nothing closes while it waits', async () => {
  let g = run(pop(newGame(1, 7), 0), 500)
  const held: Game = { ...g, mode: 'paused' }
  expect(run(held, 10_000)).toEqual(held)
})

test('it speeds up as the score climbs, to a floor', async () => {
  expect(openMs(20)).toBeLessThan(openMs(0))
  expect(openMs(1000)).toBe(700)
  expect(gapMs(1000)).toBe(350)
})

test('a click lands on the hole under it, with a cell of slack', async () => {
  const [first] = layout(44)
  expect(holeAt(44, first!.x + 2, first!.top + 1)).toBe(0)
  expect(holeAt(44, first!.x - 1, first!.top)).toBe(0)
  expect(holeAt(44, 0, 6)).toBeUndefined()
})

test('the pool draws its rows at full width, open anemones in the open colour', async () => {
  const g = run(pop(newGame(1, 7), 0), 500)
  const rows = draw(g, 44, C)
  expect(rows).toHaveLength(GAME_ROWS)
  for (const row of rows) expect(row.reduce((n, r) => n + [...r.text].length, 0)).toBe(44)
  expect(rows.flat().some(r => r.color === C.open)).toBe(true)
  expect(rows.flat().some(r => r.text.includes('1'))).toBe(true)
})
