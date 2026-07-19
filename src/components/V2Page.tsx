import { useMemo, useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import { Moon, Settings, Sun } from 'lucide-react'
import {
  DEFAULT_HUES,
  EMPTY_SPEC,
  HARMONIES,
  JsonTree,
  PRESETS,
  paletteVars,
  swatch,
  applyMode,
  compile,
  isEmptySpec,
  withGrouped,
  withHidden,
  withRule,
  type Hues,
  type Json,
  type JsonTheme,
  type Role,
  type SchemaSpec,
  type ViewMode,
} from '@adomas/json-tree'
import { useKarin } from '../store/karin'
import { NavBarShell } from './NavBar'

// Karin v.2.0 — starts from the raw feeds themselves. v.1 renders a heavily
// interpreted view (cycles, attributed usage, pricing); v.2 begins at the other
// end, showing exactly what the indexers wrote, and will earn its abstractions
// one at a time. The viewer is @adomas/json-tree, the SAME package Pepper uses —
// it lives in its own repo, so a change there lands in both apps.

// v.2 carries its OWN 2.x version line, bumped on every material v.2 change —
// separate from the app-wide v.N in appVersion.ts, which also keeps ticking.
export const V2_VERSION = 'v.2.8'

const MODE_HINT = {
  clean: 'Dates shown as Vilnius day + time',
  raw: 'Exactly as written on disk',
  schema: 'Structure only — every value replaced by its type',
} as const

const MODES = ['clean', 'raw', 'schema'] as const
type Mode = (typeof MODES)[number]

// Mapped is not a fourth mode — it is an axis crossing all three. Each mode says
// what the VALUES look like; mapped says whether your schema is applied on top.
// So you can read the raw bytes in your own key order, or the shape alone
// unedited, without one choice swallowing the other.
const SHAPES = ['original', 'mapped'] as const
type Shape = (typeof SHAPES)[number]

const SHAPE_HINT = {
  original: 'The feed as it comes, untouched by your schema',
  mapped: 'Your format: the same view with your schema edits applied',
} as const

// The spec is per feed — Codex and Claude have nothing in common shape-wise —
// and lives in localStorage so it outlives the reload that overwrites the data.
const specKey = (feed: string) => `karin.v2.schema.${feed}`

function loadSpec(feed: string): SchemaSpec {
  try {
    const raw = localStorage.getItem(specKey(feed))
    return raw ? (JSON.parse(raw) as SchemaSpec) : EMPTY_SPEC
  } catch {
    return EMPTY_SPEC
  }
}

type FeedKey = 'codex' | 'claude' | 'warp'
const FEEDS: { key: FeedKey; label: string; file: string }[] = [
  { key: 'codex', label: 'Codex', file: 'karin-data.json' },
  { key: 'claude', label: 'Claude', file: 'claude-raw.json' },
  { key: 'warp', label: 'Warp', file: 'warp-raw.json' },
]

/**
 * One segmented pill. Feed, mode and shape are three independent choices of the
 * same kind — pick one of N — so they are drawn by one component rather than
 * three near-identical blocks that drift apart.
 */
function Pill<T extends string>({
  options,
  value,
  onSelect,
  hint,
  disabled,
}: {
  options: readonly T[]
  value: T
  onSelect: (v: T) => void
  hint?: (v: T) => string | undefined
  disabled?: (v: T) => boolean
}) {
  return (
    <div className="flex rounded border border-neutral-200 p-px text-[0.68rem] dark:border-neutral-800">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onSelect(o)}
          disabled={disabled?.(o)}
          title={hint?.(o)}
          className={`rounded px-1.5 py-0.5 disabled:opacity-30 ${
            value === o
              ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export default function V2Page() {
  const setView = useKarin((s) => s.setView)
  const theme = useKarin((s) => s.theme)
  const toggleTheme = useKarin((s) => s.toggleTheme)
  // Selected one at a time: a selector returning a fresh object re-renders on every store tick.
  const codex = useKarin((s) => s.codex)
  const claude = useKarin((s) => s.claude)
  const warp = useKarin((s) => s.warp)
  const feeds = { codex, claude, warp }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [active, setActive] = useState<FeedKey>('codex')
  // 'raw' = byte-for-byte what the indexer wrote. 'clean' = the same tree with
  // timestamps rewritten to Vilnius day+time. Same JsonTree either way, so
  // collapse/expand and the big-array paging guards apply to both.
  // 'schema' = the shape only: every leaf replaced by its type, arrays merged
  // into one element, so you can read the structure without the payload.
  const [mode, setMode] = useState<Mode>('clean')
  // Independent of mode: whether the schema spec is applied to whatever mode shows.
  const [shape, setShape] = useState<Shape>('original')
  // Palette and per-path key order are viewer settings, not data — they live
  // here and are handed to JsonTree, which stays a pure renderer.
  const [palette, setPalette] = useState<JsonTheme>('auto')
  // Hues only — lightness and chroma are fixed per theme by the palette module,
  // which is what keeps four hand-picked colours equally readable. See palette.ts.
  const [hues, setHues] = useState<Hues>(DEFAULT_HUES)
  // The schema spec: the edits you make in schema view, kept beside the data.
  // The feeds are regenerated every few seconds, so an edit written INTO them
  // would not survive; as a spec it is replayed over each fresh value instead.
  const [specs, setSpecs] = useState<Record<string, SchemaSpec>>({})
  const spec = specs[active] ?? loadSpec(active)

  const editSpec = (next: SchemaSpec) => {
    setSpecs((s) => ({ ...s, [active]: next }))
    try {
      localStorage.setItem(specKey(active), JSON.stringify(next))
    } catch {
      // A full or blocked localStorage costs you persistence, not the edit.
    }
  }

  const tone = theme === 'dark' ? 'dark' : 'light'

  const raw = feeds[active] as Json | null
  // Vilnius is where this instance runs; the transform itself is zone-agnostic.
  const value = useMemo(() => {
    if (raw == null) return null
    return applyMode(raw, mode as ViewMode, { timeZone: 'Europe/Vilnius' })
  }, [raw, mode])

  // The spec is replayed on top of whichever mode is showing — that IS mapped.
  const shown = shape === 'mapped' && value != null ? compile(value, spec) : value
  // Editing is a mapped affordance: there you are looking at your own format,
  // so an edit lands where you can see it. Original stays untouched, and so
  // read-only — that is the whole point of having it beside mapped.
  const editing = shape === 'mapped'

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
      {/* Same nav scaffold as v.1 — only the tabs and the right slot differ. */}
      <NavBarShell
        versionLabel={V2_VERSION}
        onVersionClick={() => setView('sessions')}
        versionTitle="Back to Karin v.1"
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-label="Settings"
              title="Theme"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setSettingsOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-neutral-200 bg-white p-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <Sun className="h-3.5 w-3.5 text-neutral-400" />
                    <Switch.Root
                      aria-label="Toggle dark mode"
                      checked={theme === 'dark'}
                      onCheckedChange={() => toggleTheme()}
                      className="relative h-5 w-9 rounded-md bg-neutral-200 outline-none data-[state=checked]:bg-neutral-700 dark:bg-neutral-800 dark:data-[state=checked]:bg-neutral-200"
                    >
                      <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-sm bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px] dark:bg-neutral-950" />
                    </Switch.Root>
                    <Moon className="h-3.5 w-3.5 text-neutral-400" />
                  </div>
                  {/* Viewer palette — the settings menu is where future viewer
                      options (indent, open depth) go too. */}
                  <div className="mt-1 border-t border-neutral-200 px-2 pb-1 pt-1.5 dark:border-neutral-800">
                    <label className="block text-[0.68rem] text-neutral-500">JSON colours</label>
                    <select
                      value={typeof palette === 'string' ? palette : 'auto'}
                      onChange={(e) => setPalette(e.target.value as JsonTheme)}
                      className="mt-1 w-full rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-[0.7rem] dark:border-neutral-800"
                    >
                      {Object.keys(PRESETS).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    {palette === 'custom' && (
                      <div className="mt-1.5">
                        {/* Harmonies first: picking a RELATIONSHIP between the four
                            hues beats picking four colours independently. */}
                        <select
                          onChange={(e) => setHues(HARMONIES[e.target.value])}
                          defaultValue="spectrum"
                          className="w-full rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-[0.7rem] dark:border-neutral-800"
                        >
                          {Object.keys(HARMONIES).map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        {/* No key slider: keys are neutral by design, so a hue
                            control for them would suggest a choice that isn't there. */}
                        {(['string', 'number', 'null'] as Role[]).map((role) => (
                          <div key={role} className="mt-1 flex items-center gap-1.5">
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ background: swatch(hues, role, tone) }}
                            />
                            <span className="w-12 shrink-0 text-[0.65rem] text-neutral-500">{role}</span>
                            {/* Hue only — a slider that could also change lightness
                                is a slider that can make one type unreadable. */}
                            <input
                              type="range"
                              min={0}
                              max={359}
                              value={hues[role]}
                              onChange={(e) => setHues((h) => ({ ...h, [role]: Number(e.target.value) }))}
                              className="h-1 w-full accent-neutral-500"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {!isEmptySpec(spec) && (
                      <button
                        type="button"
                        onClick={() => editSpec(EMPTY_SPEC)}
                        className="mt-1.5 w-full rounded px-1 py-0.5 text-left text-[0.68rem] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      >
                        Reset {active} schema
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
            </div>
          </div>
        }
      />

      {/* The control bar: which feed, what the values look like, whose format.
          It sits below the nav rather than inside it — three pills crowd the
          brand row on a phone, and these are the choices you actually change. */}
      <div className="sticky top-0 z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-1.5 py-1 dark:border-neutral-800 dark:bg-neutral-950">
        <Pill
          options={FEEDS.map((f) => f.key)}
          value={active}
          onSelect={setActive}
          hint={(k) => `data/${FEEDS.find((f) => f.key === k)?.file}`}
          disabled={(k) => feeds[k] == null}
        />
        <Pill options={MODES} value={mode} onSelect={setMode} hint={(m) => MODE_HINT[m]} />
        <Pill options={SHAPES} value={shape} onSelect={setShape} hint={(s) => SHAPE_HINT[s]} />
      </div>

      <main
        className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[0.78rem] leading-relaxed"
        // The custom preset's atoms read these; a preset that doesn't use them
        // simply ignores them, so this is safe to set unconditionally.
        style={paletteVars(hues, tone)}
      >
        {value == null ? (
          <p className="text-neutral-500">
            No {FEEDS.find((f) => f.key === active)?.label} feed loaded — run the indexer for it.
          </p>
        ) : (
          <JsonTree
            value={shown as Json}
            openDepth={2}
            theme={palette}
            // Editing lives in mapped, in any mode: that is where you are looking
            // at your own format, so an edit lands where you can see it.
            onReorder={editing ? (path, keys) => editSpec(withRule(spec, path, { order: keys })) : undefined}
            onHide={editing ? (path, key) => editSpec(withHidden(spec, path, key)) : undefined}
            // Grouping folds sibling keys — three separate timestamps, say —
            // under one object. Typing the same name on each collects them;
            // an empty answer takes a key back out.
            onGroup={
              editing
                ? (path, key) => {
                    // A row already inside a group is drawn one level deeper than
                    // the rule that put it there, so aim at the parent's path.
                    const cut = path.lastIndexOf('.')
                    const parent = cut < 0 ? '' : path.slice(0, cut)
                    const last = cut < 0 ? path : path.slice(cut + 1)
                    const owner = spec[parent]?.group?.[last] ? parent : path
                    const current = Object.entries(spec[owner]?.group ?? {}).find(([, ks]) => ks.includes(key))?.[0]
                    const next = window.prompt(`Group "${key}" under (blank to ungroup):`, current ?? '')
                    if (next === null) return
                    editSpec(withGrouped(spec, owner, key, next.trim() || null))
                  }
                : undefined
            }
            onRename={
              editing
                ? (path, key) => {
                    const next = window.prompt(`Rename "${key}" to:`, spec[path]?.rename?.[key] ?? key)
                    if (next && next !== key) editSpec(withRule(spec, path, { rename: { [key]: next } }))
                  }
                : undefined
            }
          />
        )}
      </main>
    </div>
  )
}
