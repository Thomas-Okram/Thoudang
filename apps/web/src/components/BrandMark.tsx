/** Thoudang mark: a document with a "T" stroke and a tick — reads, checks, hands back. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="tdg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#0b7a6e" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#tdg)" />
      <path d="M11 13h18M20 13v15" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="29" cy="28" r="6.5" fill="#0a1b33" />
      <path
        d="m26.2 28.1 1.9 1.9 3.6-3.7"
        stroke="#5eead4"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
