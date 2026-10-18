/**
 * The mascot: a little document getting squished flat by a press. "Dabaao" = press hard.
 * mood: "rest" (press raised), "squished" (pressed flat, the logo pose), "loop" (pressing away — work in progress),
 * "happy" (sprung back after fitting).
 */
export type Mood = "rest" | "squished" | "loop" | "happy";

export function Squisher({ mood = "rest", size = 64, className = "" }: { mood?: Mood; size?: number; className?: string }) {
  return (
    <svg
      className={`squisher ${mood} ${className}`}
      width={size}
      height={(size * 100) / 120}
      viewBox="0 0 120 100"
      aria-hidden="true"
    >
      <g className="press">
        <rect x="54" y="-30" width="12" height="54" rx="2" className="rod" />
        <rect x="18" y="20" width="84" height="13" rx="4" className="plate" />
        <rect x="26" y="23" width="18" height="4" rx="2" className="shine" />
      </g>
      <g className="puffs">
        <path d="M22 80 q-8 -3 -12 -10 M24 88 q-10 0 -16 -4" />
        <path d="M98 80 q8 -3 12 -10 M96 88 q10 0 16 -4" />
      </g>
      <g className="doc">
        <path d="M36 36 h36 l14 14 v38 a4 4 0 0 1 -4 4 h-46 a4 4 0 0 1 -4 -4 v-48 a4 4 0 0 1 4 -4 z" className="paper" />
        <path d="M72 36 v10 a4 4 0 0 0 4 4 h10" className="fold" />
        <g className="face face-squish">
          <path d="M45 58 l7 4 l-7 4" />
          <path d="M75 58 l-7 4 l7 4" />
          <ellipse cx="60" cy="76" rx="4" ry="5" className="mouth" />
        </g>
        <g className="face face-happy">
          <circle cx="49" cy="61" r="3.4" className="eye" />
          <circle cx="71" cy="61" r="3.4" className="eye" />
          <path d="M53 72 q7 7 14 0" />
        </g>
        <circle cx="42" cy="70" r="4" className="cheek" />
        <circle cx="78" cy="70" r="4" className="cheek" />
      </g>
      <path d="M93 44 q4 6 0 9 q-4 -3 0 -9 z" className="sweat" />
      <path d="M8 93 h104" className="ground" />
    </svg>
  );
}

/** The wordmark: each letter squashed a little more, as if mid-press. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="dabaao">
      {"dabaao!".split("").map((ch, i) => (
        <span key={i} className={`l l${i}`} aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  );
}
