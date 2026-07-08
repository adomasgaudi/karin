import type { SessionSource } from '../types'
import {
  CURRENCY_LABELS,
  EUR_PER_USD,
  PRICE_BASIS_NOTES,
  SUB_DIVISOR_SOURCE_NOTES,
  stepSubDivisor,
  type CurrencyMode,
  type PriceBasis,
  type TokenRates,
} from '../lib/pricing'

const SOURCE_LABELS: Record<SessionSource, string> = { codex: 'Codex', claude: 'Claude' }

// One ÷N tuner row for a source's plan-estimate divisor.
function DivisorRow({
  source,
  value,
  onStep,
  active,
}: {
  source: SessionSource
  value: number
  onStep: (dir: 1 | -1) => void
  active: boolean
}) {
  return (
    <div className={`rounded border px-2 py-1.5 ${active ? 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-700 dark:text-neutral-200">
          {SOURCE_LABELS[source]} plan
          {active && <span className="ml-1 text-[0.62rem] font-normal text-sky-600 dark:text-sky-400">(this session)</span>}
        </span>
        <div className="inline-flex items-center rounded-md border border-neutral-300 bg-neutral-100 text-[0.68rem] font-medium text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
          <button type="button" onClick={() => onStep(-1)} title="Smaller divisor → higher estimate" className="px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700">
            −
          </button>
          <span className="min-w-[2.5rem] px-1 text-center tabular-nums">÷{value}</span>
          <button type="button" onClick={() => onStep(1)} title="Larger divisor → lower estimate" className="px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700">
            +
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-[0.64rem] leading-relaxed text-neutral-500 dark:text-neutral-400">{SUB_DIVISOR_SOURCE_NOTES[source]}</p>
    </div>
  )
}

// Traceable pricing-model dropdown for money mode. Explains what the active price MEANS
// (api list vs plan estimate + formula + caveats), lets the owner tune the plan-estimate
// divisor SEPARATELY per source (Codex vs Claude plans differ), and — when a single session
// is in view — shows the verbatim API list rate table + source so any wrong-looking figure
// can be traced. apiRates are the UNSCALED list rates; the divisor is shown separately.
export default function PriceModelPanel({
  basis,
  subDivisors,
  onSetDivisor,
  activeSource,
  apiRates,
  currency,
  model,
  onClose,
}: {
  basis: PriceBasis
  subDivisors: Record<SessionSource, number>
  onSetDivisor: (source: SessionSource, n: number) => void
  activeSource?: SessionSource
  apiRates?: TokenRates | null
  currency: CurrencyMode
  model?: string | null
  onClose: () => void
}) {
  const note = PRICE_BASIS_NOTES[basis]
  const rateRows: { label: string; value: number | null; hint?: string }[] = apiRates
    ? [
        { label: 'input', value: apiRates.input },
        { label: 'cached', value: apiRates.cached, hint: apiRates.cached == null ? 'billed at input rate' : undefined },
        ...(apiRates.cacheWrite5m != null ? [{ label: 'cache write 5m', value: apiRates.cacheWrite5m }] : []),
        ...(apiRates.cacheWrite1h != null ? [{ label: 'cache write 1h', value: apiRates.cacheWrite1h }] : []),
        { label: 'output', value: apiRates.output },
      ]
    : []

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-md border border-neutral-200 bg-white p-3 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-neutral-700 dark:text-neutral-200">How this price is computed</span>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            ✕
          </button>
        </div>

        <div className="mb-1 font-medium text-neutral-700 dark:text-neutral-200">{note.title}</div>
        <div className="mb-1.5 rounded bg-neutral-50 px-2 py-1 font-mono text-[0.66rem] leading-relaxed text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
          {note.formula}
        </div>
        <p className="mb-2 leading-relaxed text-neutral-500 dark:text-neutral-400">{note.detail}</p>

        <div className="border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <div className="mb-1.5 font-medium text-neutral-600 dark:text-neutral-300">
            Plan-estimate divisors <span className="font-normal text-neutral-400 dark:text-neutral-500">— set per plan</span>
          </div>
          <div className="grid gap-1.5">
            <DivisorRow source="codex" value={subDivisors.codex} active={activeSource === 'codex'} onStep={(d) => onSetDivisor('codex', stepSubDivisor(subDivisors.codex, d))} />
            <DivisorRow source="claude" value={subDivisors.claude} active={activeSource === 'claude'} onStep={(d) => onSetDivisor('claude', stepSubDivisor(subDivisors.claude, d))} />
          </div>
          <p className="mt-1.5 text-[0.64rem] leading-relaxed text-neutral-400 dark:text-neutral-500">
            They differ because the plans differ (price, allowance, model mix). Neither vendor publishes exact token
            allowances, so these are calibrated estimates — tune each until a known period matches your real plan.
          </p>
        </div>

        {rateRows.length > 0 && (
          <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="font-medium text-neutral-600 dark:text-neutral-300">API list rate table</span>
              <span className="font-mono text-[0.64rem] text-neutral-400 dark:text-neutral-500">{model || 'model n/a'}</span>
            </div>
            <div className="grid gap-0.5">
              {rateRows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between">
                  <span className="text-neutral-500 dark:text-neutral-400">{r.label}</span>
                  <span className="tabular-nums text-neutral-700 dark:text-neutral-200">
                    {r.value == null ? '—' : `$${r.value}/Mtok`}
                    {r.hint ? <span className="ml-1 text-[0.62rem] text-neutral-400 dark:text-neutral-500">({r.hint})</span> : null}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-[0.64rem] leading-relaxed text-neutral-400 dark:text-neutral-500">
              {apiRates?.context === 'long' ? 'long-context' : 'standard-context'} rates · {apiRates?.source}
              {currency.startsWith('eur') ? ` · shown in ${CURRENCY_LABELS[currency]} at €${EUR_PER_USD}/$` : ''}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
