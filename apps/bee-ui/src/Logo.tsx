// Bee's own mark — a small bee in a honeycomb cell, distinct from the Hive's hex.
// Colored via --color-accent (amber in this app), no emoji.
export function BeeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* honeycomb cell */}
      <path d="M12 2.6 19.4 7v10L12 21.4 4.6 17V7L12 2.6Z" stroke="var(--color-accent)" strokeWidth="1.4" strokeLinejoin="round" opacity="0.55" />
      {/* wings */}
      <ellipse cx="8.7" cy="10" rx="2.1" ry="3" fill="var(--color-accent)" opacity="0.35" />
      <ellipse cx="15.3" cy="10" rx="2.1" ry="3" fill="var(--color-accent)" opacity="0.35" />
      {/* striped body */}
      <rect x="10" y="8.5" width="4" height="7.5" rx="2" fill="var(--color-accent)" />
      <rect x="10" y="10.4" width="4" height="1" fill="var(--background)" opacity="0.9" />
      <rect x="10" y="12.6" width="4" height="1" fill="var(--background)" opacity="0.9" />
    </svg>
  );
}
