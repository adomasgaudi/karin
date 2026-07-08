import {
  CURRENCY_LABELS,
  EUR_PER_USD,
  PRICE_BASIS_NOTES,
  type CurrencyMode,
  type PriceBasis,
  type TokenRates,
} from '../lib/pricing'

// Traceable pricing-model panel for money mode. Lays out, in order: the active basis (what
// the number means + its formula + caveats), the plan-estimate divisor when relevant, and
// the verbatim API list rate table the figures are built from — so any wrong-looking cost
// can be traced back to a rate, a source, or the divisor. apiRates are the UNSCALED list
// rates (the divisor is shown separately, not folded in) so the source of truth stays legible.
export default function PriceModelPanel({
  basis,
  subDivisor,
  apiRates,
  currency,
  model,
  onClose,
}: {
  basis: PriceBasis
  subDivisor: number
  apiRates: TokenRates | null
  currency: CurrencyMode
  model: string | null | undefined
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
      <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-neutral-200 bg-white p-3 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
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

        {basis === 'sub' && (
          <div className="mb-2 rounded border border-amber-200/70 bg-amber-50/60 px-2 py-1 text-[0.68rem] leading-relaxed text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            Divisor <span className="font-semibold tabular-nums">÷{subDivisor}</span> — calibrated estimate, tune it with the ± stepper.
            A ~$200/mo plan reportedly returns ~10-25× its fee in API-equivalent compute, so ÷10 to ÷25 is the sane range.
          </div>
        )}

        {rateRows.length > 0 ? (
          <div className="border-t border-neutral-100 pt-2 dark:border-neutral-800">
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
        ) : (
          <div className="border-t border-neutral-100 pt-2 text-[0.68rem] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            No rate table for “{model || 'this model'}” — cost falls back to raw tokens.
          </div>
        )}
      </div>
    </>
  )
}
