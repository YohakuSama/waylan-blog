/**
 * Dotted network wave for the home hero. Pure SVG computed once at module load:
 * deterministic for prerendering, themed through CSS custom properties and
 * free of canvas/3D dependencies.
 */
const W = 760,
  H = 380,
  ROWS = 26,
  COLS = 34,
  STEPS = 56;
function point(u: number, v: number): [number, number] {
  // u runs left→right, v runs back→front. Front rows are taller and wider.
  const depth = 0.42 + 0.58 * v;
  const wave =
    Math.sin(u * Math.PI * 2.1 + v * 2.6) * 46 * depth +
    Math.sin(u * Math.PI * 5.2 - v * 1.4) * 9 * depth;
  const lift = Math.pow(1 - u, 1.6) * 70 * (1 - v * 0.4);
  const x = W * 0.05 + u * W * 0.93 + (1 - v) * 30 - v * 10;
  const y = 50 + v * 230 + wave - lift + u * 40;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}
const pathFor = (points: [number, number][]) =>
  "M" + points.map(([x, y]) => `${x} ${y}`).join("L");
const rows = Array.from({ length: ROWS }, (_, r) =>
  pathFor(
    Array.from({ length: STEPS + 1 }, (_, s) =>
      point(s / STEPS, r / (ROWS - 1)),
    ),
  ),
);
const cols = Array.from({ length: COLS }, (_, c) =>
  pathFor(
    Array.from({ length: ROWS }, (_, r) =>
      point(c / (COLS - 1), r / (ROWS - 1)),
    ),
  ),
);
const nodeAt = (c: number, r: number) => point(c / (COLS - 1), r / (ROWS - 1));
const nodes = [
  [22, 6],
  [27, 11],
  [31, 4],
  [18, 15],
  [25, 19],
  [30, 16],
  [14, 9],
].map(([c, r]) => nodeAt(c, r));
const links: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 4],
  [3, 4],
  [4, 5],
  [0, 6],
  [1, 5],
];
export function NetworkWave({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`network-wave ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wave-tint" x1="0" x2="1" y1="0" y2="0">
          <stop
            offset="0"
            style={{ stopColor: "var(--wave-ink)", stopOpacity: 0.2 }}
          />
          <stop
            offset="0.3"
            style={{ stopColor: "var(--wave-ink)", stopOpacity: 0.5 }}
          />
          <stop
            offset="0.55"
            style={{ stopColor: "var(--accent)", stopOpacity: 0.85 }}
          />
          <stop
            offset="0.8"
            style={{ stopColor: "var(--accent)", stopOpacity: 0.6 }}
          />
          <stop
            offset="1"
            style={{ stopColor: "var(--wave-ink)", stopOpacity: 0.35 }}
          />
        </linearGradient>
        <radialGradient id="wave-glow" cx="0.58" cy="0.62" r="0.42">
          <stop
            offset="0"
            style={{ stopColor: "var(--accent)", stopOpacity: 0.16 }}
          />
          <stop
            offset="1"
            style={{ stopColor: "var(--accent)", stopOpacity: 0 }}
          />
        </radialGradient>
      </defs>
      <rect className="wave-glow" width={W} height={H} fill="url(#wave-glow)" />
      <g className="wave-cols" stroke="url(#wave-tint)">
        {cols.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g className="wave-rows" stroke="url(#wave-tint)">
        {rows.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g className="wave-links">
        {links.map(([a, b]) => (
          <path
            key={`${a}-${b}`}
            d={`M${nodes[a][0]} ${nodes[a][1]}L${nodes[b][0]} ${nodes[b][1]}`}
          />
        ))}
      </g>
      <g className="wave-rings">
        <circle cx={nodes[1][0]} cy={nodes[1][1]} r="34" />
        <circle cx={nodes[4][0]} cy={nodes[4][1]} r="58" />
      </g>
      <g className="wave-nodes">
        {nodes.map(([x, y], i) => (
          <rect
            key={i}
            x={x - (i % 3 ? 3 : 4.5)}
            y={y - (i % 3 ? 3 : 4.5)}
            width={i % 3 ? 6 : 9}
            height={i % 3 ? 6 : 9}
            className={i === 1 || i === 4 ? "accent" : undefined}
          />
        ))}
      </g>
      <g className="wave-cross">
        <path d={`M${W - 92} 58h22M${W - 81} 47v22`} />
      </g>
    </svg>
  );
}
