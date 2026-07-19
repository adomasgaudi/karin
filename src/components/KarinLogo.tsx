// The Karin glasses mark. Shared by the v.1 sidebar and the v.2 header so the
// two versions can't drift apart visually.
export default function KarinLogo({ className = 'h-5 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 18" className={className} aria-hidden="true">
      {/* frame arms */}
      <line x1="0" y1="9" x2="3" y2="9" stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="37" y1="9" x2="40" y2="9" stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round" />
      {/* left lens */}
      <circle cx="10" cy="9" r="7" fill="none" stroke="#dc2626" strokeWidth="1.6" />
      {/* left eye - fully red, no pupil, shaped for focused expression */}
      <path d="M5 6.5 C5 6.5 10 5.5 15 6.5 C15 6.5 13 12.5 10 12.5 C7 12.5 5 6.5 5 6.5Z" fill="#dc2626" />
      {/* right lens */}
      <circle cx="30" cy="9" r="7" fill="none" stroke="#dc2626" strokeWidth="1.6" />
      {/* right eye */}
      <path d="M25 6.5 C25 6.5 30 5.5 35 6.5 C35 6.5 33 12.5 30 12.5 C27 12.5 25 6.5 25 6.5Z" fill="#dc2626" />
      {/* bridge */}
      <path d="M17 9 Q20 6 23 9" fill="none" stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
