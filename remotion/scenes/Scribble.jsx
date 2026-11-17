// Hand-drawn marks: loose circles, underlines and highlighter swipes that draw
// themselves on, like someone marking up the frame with a pen. Shapes are
// jittered from a seed, so every mark looks hand-made but renders the same each
// time.

// A small seeded random number generator (mulberry32).
function random(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// A seed from any text, so the same content always gets the same wobble.
export function seedOf(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// A smooth path through points (Catmull-Rom as cubic Béziers).
function smooth(points) {
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// A loose loop around (cx, cy): a bit more than one turn, never quite round,
// with the ends overlapping like a pen circle.
export function loopPath(cx, cy, rx, ry, seed) {
  const rand = random(seed);
  const start = -2.2 + rand() * 0.6;
  const turn = Math.PI * 2 * (1.12 + rand() * 0.08);
  const points = [];
  for (let i = 0; i <= 28; i++) {
    const a = start + (turn * i) / 28;
    const wobble = 1 + (rand() - 0.5) * 0.08 + (i / 28) * 0.07;
    points.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble]);
  }
  return smooth(points);
}

// A quick underline from (x1, y) to (x2, y) that sags and lifts a little.
export function strokePath(x1, x2, y, seed) {
  const rand = random(seed);
  const points = [];
  for (let i = 0; i <= 8; i++) {
    const x = x1 + ((x2 - x1) * i) / 8;
    points.push([x, y + Math.sin((i / 8) * Math.PI) * (3 + rand() * 4) + (rand() - 0.5) * 3 - (i / 8) * 4]);
  }
  return smooth(points);
}

// One mark, drawn on as `progress` goes from 0 to 1. Use cap="butt" for marks
// stretched to fit (preserveAspectRatio="none"), where round ends would stretch too.
export function Mark({ d, progress, color, width = 6, opacity = 1, cap = "round" }) {
  if (progress <= 0) return null;
  return (
    <path
      d={d}
      pathLength={1}
      strokeDasharray="1 1"
      strokeDashoffset={1 - Math.min(1, progress)}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap={cap}
      strokeLinejoin="round"
      opacity={opacity}
    />
  );
}
