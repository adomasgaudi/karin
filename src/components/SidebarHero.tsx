import { ArrowUpRight, Orbit } from 'lucide-react'

export default function SidebarHero({ sessionCount }: { sessionCount: number }) {
  return (
    <section className="relative mx-1 mb-2 overflow-hidden rounded-2xl border border-neutral-200/80 bg-neutral-50 px-4 py-4 dark:border-white/10 dark:bg-white/[0.035]">
      {/* A deliberately quiet atmosphere: the highlight only reveals itself as the eye moves. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_8%,rgba(115,115,115,0.15),transparent_31%),linear-gradient(132deg,transparent_50%,rgba(255,255,255,0.45))] dark:bg-[radial-gradient(circle_at_92%_8%,rgba(255,255,255,0.12),transparent_31%),linear-gradient(132deg,transparent_50%,rgba(255,255,255,0.035))]" />
      <div className="relative">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1.5"><Orbit className="h-3 w-3" /> Karin</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
        </div>
        <h1 className="mt-5 max-w-[15rem] text-[1.55rem] font-medium leading-[1.08] tracking-[-0.045em] text-neutral-950 dark:text-white">
          Your work, in full context.
        </h1>
        <p className="mt-2.5 max-w-[18rem] text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          A private record of every decision, turn, and tool call — kept entirely on this machine.
        </p>
        <div className="mt-5 flex items-center gap-2 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
          <span>{sessionCount} sessions indexed locally</span>
        </div>
      </div>
    </section>
  )
}
