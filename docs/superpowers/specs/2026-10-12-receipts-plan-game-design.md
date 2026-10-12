# Receipts, plan states, anemone pop — design

Date: 2026-10-12. Order agreed: receipts → plan → game. Each part ships on its own and passes `./verify.sh`.

Inspiration: the "Mods will 10x your Claude Code" video (receipt mod), zycck/claude-mods plan-progress and
its forks (bar states, stage ticks, plan-mode plans, agent rows), intermission / claude-doom (play while
Claude works). Not copied: animated bar styles (decoration), Doom itself (needs kitty graphics; Orca has none).

## 1. Full receipts

A receipt is what a turn opened and changed, counted by kind, from `calls` (already tracked per turn).

| Kind | From | Shown as |
|---|---|---|
| pages | WebFetch, by URL host | `2 pages (code.claude.com, github.com)` (hosts deduped, at most 2 then `+n`) |
| searches | WebSearch | `1 search` |
| read | Read, Grep, Glob (distinct files for Read) | `6 read` |
| edited | Edit, MultiEdit, Write (distinct files) | `2 edited` |
| shell | Bash (foreground + background) | `3 shell` |
| agents | Agent | `1 agent` |
| MCP | `mcp__<server>__<tool>`, by server's short name | `Linear ×2` |
| other | everything else (Task*, TodoWrite excluded: they are the plan, not work) | `2 other` |

- New pure function `receipt(rows, calls)` in `hooks/receipt.ts` → ordered parts; zero kinds dropped.
- **Anchor line** (`features/tools.tsx`): `◇ <receipt> · 52s` replaces `◇ 14 tools · 1 agent · …`; errors and
  `▸ rail` stay. Narrow chat: parts drop from the end (other, MCP, shell…), duration always kept.
- **Rail timeline header** (`features/rail.tsx`): same parts under the turn's prompt line. Pressing a part
  filters the timeline to that kind; pressing it again clears the filter (rail-local, not stored).
- Failed calls are left out (they opened nothing; the error count shows them).
- **No tools at all:** the rail's turn header says `from memory`. The chat has no tool row to anchor on, so no
  chat line (an AssistantMessage footer was considered and dropped: it would sit on every short reply).

Test: `tests/receipt.test.ts` — mixed turn, MCP grouping, dedupe, truncation order, from-memory.

## 2. Plan progress

**Bar states** (Plan header pill and the rail plan header):
- running — today's accent.
- **waiting on you** — amber (palette `warn`) with `needs you`: set by `classic.Notification` of type
  `permission_prompt`, or a live `AskUserQuestion` call; cleared by the next tool call or turn step.
- **stalled** — red (`crit`) with `stopped`: the turn ended on an error or Esc with tasks unfinished; cleared
  when the next turn starts.
- done — today's green card.
State lives in a new `$.state` atom `planState: 'running' | 'waiting' | 'stalled'`.

**Stage ticks:** the header's bar becomes one segment per top-level task in the same `━╸─` style: done
segments filled, the running one filled by its elapsed/estimate (capped below full), pending as track, and a
blank cell between segments (cleaner than a `┃` in this meter style). Two cells a stage: the bar widens past 12
cells for longer plans, up to 24 (8 tasks); past that it falls back to today's single bar.

**Plan mode → plan:** when `ExitPlanMode` is approved (tool.call result not denied), Tidepool appends one line
to its result for the model: "Track this plan with TaskCreate, one task per step, before starting." The
existing tasks band then draws it. No parser for plan markdown, no second plan store.

**Agent rows:** each agent row adds its model (Agent input `model`, else the subagent type's) and the tool
it is running now (latest live call with that `agentId`): `◈ explore · haiku · Grep  1m 02s`.

**Resume:** `tasks` is mirrored to `$.store` on each change, in one `plans-by-session` map (newest 20) keyed by
`$.session.usage().startedAt`, which a resume keeps (`session.start` carries no `source`). On `session.start` an
unfinished plan under the current key is restored when the session's own plan is empty.

Tests: extend `tests/plan*.test.ts` and `rail-render` for states, ticks, agent rows; one for the
ExitPlanMode nudge; one for restore on resume.

## 3. Anemone pop

A whack-a-mole in the rail while Claude works. It replaced a first-built crab runner, which played too much like
the dock's own crab loader.

- **Where:** a rail section `play` below the others, a score line and 7 pool rows, shown only while a turn runs
  and the game is on (default off; `/tidepool-play` toggles it, kept in the store as `game-on`). Its fold mark
  turns the game off.
- **How:** a `Client` surface module `hooks/features/pop-surface.tsx` (local state, `every` timer at 10 fps,
  `onPointer`, `onKey`). Anemones open in two staggered rows of numbered holes (up to 9); click one, or press
  its number, before it closes. One left to close costs a life; three and the round is over. It speeds up with
  the score. A hole about to close dims; a pop flashes ✦, a miss ✕.
- **Respects Claude:** the hooks module passes `{ paused, ending }` as props. Paused while Claude needs you (the
  round's clock stops, so nothing closes while you are away); on turn end a 3-second countdown, then the section
  folds. Never takes focus on its own.
- **Score:** pops; best kept in `$.store` (`game-best`) via `post` → `ui.message`.

Test: `tests/pop.test.ts` — layout, scoring, lives, held rounds, speed-up, click mapping, drawing; the rail
test covers on/off, pause/ending props, the best-score message and the fold.

## Out of scope

Bar animation styles, multiplayer, sounds per step, a plan_progress tool of our own.
