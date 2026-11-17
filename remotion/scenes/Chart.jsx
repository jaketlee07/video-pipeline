import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BOTTOM_SPACE, colors, fonts } from "../theme.js";
import { Backdrop } from "./Backdrop.jsx";
import { Mark, loopPath, seedOf } from "./Scribble.jsx";

// Decimal places in a value as given (at most two), so 154 never shows as 128.8
// while its bar grows.
const decimalsOf = (value) => Math.min(2, (String(value).split(".")[1] ?? "").length);

// A scale in the unit ("$ millions", "billion dollars") as a suffix, so 684.6
// in millions reads $684.6M rather than $684.6.
const SCALE = { thousand: "K", million: "M", billion: "B", trillion: "T" };

function format(value, unit = "", decimals = 1) {
  const n = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const scale = SCALE[unit.match(/\b(thousand|million|billion|trillion)s?\b/i)?.[1].toLowerCase()] ?? "";
  if (/^\$|dollar/i.test(unit)) return `$${n}${scale}`;
  if (/%|percent/i.test(unit)) return `${n}%`;
  return unit ? `${n} ${unit}` : n;
}

const LEFT = 180;
const WIDTH = 1560;
const TOP = 270;
const BOTTOM = 1080 - BOTTOM_SPACE - 70;

function Frame({ chart, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  return (
    <Backdrop>
      {chart.headline ? (
        <div style={{ position: "absolute", left: LEFT, top: 56, opacity: enter }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 116, lineHeight: 1, color: colors.text, textTransform: "uppercase", letterSpacing: 2 }}>
            {chart.headline}
          </div>
          <div style={{ marginTop: 10, fontFamily: fonts.body, fontWeight: 600, fontSize: 28, letterSpacing: 2, textTransform: "uppercase", color: colors.muted }}>
            {chart.title}
          </div>
        </div>
      ) : (
        <div style={{ position: "absolute", left: LEFT, top: 100, opacity: enter, fontFamily: fonts.display, fontWeight: 800, fontSize: 76, color: colors.text }}>
          {chart.title}
        </div>
      )}
      {children}
      <div style={{ position: "absolute", left: LEFT, top: BOTTOM + 30, fontFamily: fonts.body, fontWeight: 500, fontSize: 24, color: colors.muted, opacity: enter }}>
        Source: {chart.source}
      </div>
    </Backdrop>
  );
}

// Horizontal bars, which leave room for long labels.
function BarChart({ chart }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...chart.points.map((p) => p.value));
  const row = Math.min(170, (BOTTOM - TOP) / chart.points.length);
  // The biggest value gets circled by hand once its bar has grown. Its label sits
  // after the bar, about half a character-height wide per character.
  const top = chart.points.findIndex((p) => p.value === max);
  const labelX = LEFT + Math.max(10, WIDTH - 380) + 20;
  const labelW = format(max, chart.unit, decimalsOf(max)).length * 28;
  const labelY = TOP + top * row + 84;
  const circled = interpolate(frame, [8 + top * 8 + 40, 8 + top * 8 + 58], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Frame chart={chart}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Mark d={loopPath(labelX + labelW / 2, labelY, labelW / 2 + 34, 50, seedOf(chart.title))} progress={circled} color={colors.text} width={5} opacity={0.9} />
      </svg>
      {chart.points.map((point, i) => {
        const grow = spring({ frame: frame - 8 - i * 8, fps, config: { damping: 200 }, durationInFrames: 40 });
        const width = Math.max(10, ((WIDTH - 380) * point.value) / max) * grow;
        const top = TOP + i * row;
        const highlight = point.value === max;
        return (
          <div key={i} style={{ position: "absolute", left: LEFT, top, width: WIDTH }}>
            <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 32, color: colors.text, marginBottom: 12, opacity: grow }}>{point.label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ width, height: Math.min(64, row * 0.4), borderRadius: 6, background: highlight ? colors.accent : colors.accent2 }} />
              <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 56, whiteSpace: "nowrap", color: highlight ? colors.accent : colors.text, opacity: grow }}>
                {format(point.value * grow, chart.unit, decimalsOf(point.value))}
              </div>
            </div>
          </div>
        );
      })}
    </Frame>
  );
}

// A line drawn left to right, with each value labelled as the line reaches it.
function LineChart({ chart }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const values = chart.points.map((p) => p.value);
  const max = Math.max(...values) * 1.15;
  const min = Math.min(0, ...values);
  const x = (i) => LEFT + 60 + ((WIDTH - 120) * i) / Math.max(1, chart.points.length - 1);
  const y = (v) => BOTTOM - 60 - ((BOTTOM - TOP - 60) * (v - min)) / (max - min);
  const xy = chart.points.map((p, i) => [x(i), y(p.value)]);
  const lengths = xy.map((p, i) => (i ? Math.hypot(p[0] - xy[i - 1][0], p[1] - xy[i - 1][1]) : 0));
  const total = lengths.reduce((a, b) => a + b, 0);
  const drawn = interpolate(frame, [10, 10 + 1.6 * fps], [0, total], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let reached = 0;
  const peak = values.indexOf(Math.max(...values));
  const peakLabel = format(values[peak], chart.unit, decimalsOf(values[peak]));
  const circled = interpolate(frame, [12 + 1.6 * fps, 30 + 1.6 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Frame chart={chart}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Mark d={loopPath(xy[peak][0], xy[peak][1] - 34, Math.max(80, peakLabel.length * 13 + 40), 62, seedOf(chart.title))} progress={circled} color={colors.text} width={5} opacity={0.9} />
        <line x1={LEFT} x2={LEFT + WIDTH} y1={y(min)} y2={y(min)} stroke={colors.line} strokeWidth={3} />
        <polyline
          points={xy.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke={colors.accent}
          strokeWidth={8}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={total}
          strokeDashoffset={total - drawn}
        />
        {chart.points.map((point, i) => {
          reached += lengths[i];
          const shown = drawn >= reached - 1;
          return (
            <g key={i} opacity={shown ? 1 : 0}>
              <circle cx={xy[i][0]} cy={xy[i][1]} r={12} fill={colors.accent} stroke={colors.background} strokeWidth={4} />
              <text x={xy[i][0]} y={xy[i][1] - 30} textAnchor="middle" fontFamily={fonts.display} fontWeight={800} fontSize={44} fill={colors.text}>
                {format(point.value, chart.unit, decimalsOf(point.value))}
              </text>
              <text x={xy[i][0]} y={y(min) + 50} textAnchor="middle" fontFamily={fonts.body} fontWeight={600} fontSize={28} fill={colors.muted}>
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </Frame>
  );
}

export function Chart({ chart }) {
  return chart.kind === "line" ? <LineChart chart={chart} /> : <BarChart chart={chart} />;
}
