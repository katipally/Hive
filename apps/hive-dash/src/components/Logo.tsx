// Honeycomb hex mark for the Hive wordmark (no emoji).
export function HexMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7L12 2.2Z"
        stroke="var(--color-honey)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 7.5 16.3 10v4L12 16.5 7.7 14v-4L12 7.5Z" fill="var(--color-honey)" opacity="0.9" />
    </svg>
  );
}
