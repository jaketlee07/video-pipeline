import { geoAlbersUsa, geoPath } from "d3-geo";
import { mesh } from "topojson-client";
import us from "us-atlas/counties-albers-10m.json";
import { AbsoluteFill } from "remotion";
import { colors, fonts } from "../theme.js";
import { Mark, loopPath, seedOf, strokePath } from "../scenes/Scribble.jsx";

// The channel's profile picture and banner, in the videos' palette, fonts and pen
// marks. Rendered by src/channel-art.mjs.

const glow = `radial-gradient(ellipse at 50% 42%, ${colors.panel} 0%, ${colors.background} 72%)`;
const dots = (opacity) => ({ backgroundImage: `radial-gradient(${colors.line} 1.5px, transparent 1.5px)`, backgroundSize: "36px 36px", opacity });

// 800×800, shown as a circle as small as 36 pixels, so one bold shape: a receipt
// with its total circled ("receipt"), or the initials ("monogram").
export function ProfilePicture({ variant = "receipt" }) {
  return (
    <AbsoluteFill style={{ background: glow }}>
      {variant === "monogram" ? <Monogram /> : <Receipt />}
    </AbsoluteFill>
  );
}

function Receipt() {
  // The paper, with a torn zigzag bottom edge.
  const [x, y, w, h] = [245, 150, 310, 470];
  const teeth = 9;
  const zigzag = Array.from({ length: teeth * 2 + 1 }, (_, i) => `${x + w - (i * w) / (teeth * 2)},${y + h + (i % 2 ? 0 : 22)}`).join(" ");
  const bar = (bx, by, bw, color = colors.inkMuted, bh = 16) => <rect x={bx} y={by} width={bw} height={bh} rx={bh / 2} fill={color} />;
  return (
    <svg width={800} height={800} viewBox="0 0 800 800">
      <g transform="rotate(-7 400 400) translate(400 396) scale(1.14) translate(-400 -396)">
        <polygon points={`${x},${y} ${x + w},${y} ${zigzag} ${x},${y + h + 22}`} fill={colors.paper} />
        {bar(x + 85, y + 48, 140, colors.ink, 22)}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            {bar(x + 40, y + 120 + i * 58, 130 - i * 22)}
            {bar(x + w - 40 - 62, y + 120 + i * 58, 62)}
          </g>
        ))}
        <rect x={x + 32} y={y + 304} width={w - 64} height={5} fill={colors.inkMuted} opacity={0.6} />
        {bar(x + 40, y + 350, 96, colors.ink, 26)}
        {bar(x + w - 40 - 92, y + 350, 92, colors.ink, 26)}
        <Mark d={loopPath(x + w - 40 - 46, y + 363, 88, 56, seedOf("total"))} progress={1} color={colors.accent} width={17} />
      </g>
    </svg>
  );
}

function Monogram() {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 330, color: colors.text, letterSpacing: 4, marginTop: -40 }}>ECS</div>
      <svg width={800} height={800} viewBox="0 0 800 800" style={{ position: "absolute" }}>
        <Mark d={strokePath(190, 610, 590, seedOf("ECS"))} progress={1} color={colors.accent} width={20} />
      </svg>
    </AbsoluteFill>
  );
}

// 2048×1152. Every device shows the middle 1235×338, so the name and line sit
// there; TVs show it all, over a faint map of the states.
const STATE_LINES = geoPath()(mesh(us, us.objects.states, (a, b) => a !== b));
const NATION_EDGE = geoPath()(mesh(us, us.objects.nation));
// The towns of the first case study, as dots on the map.
const project = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const TOWNS = [
  [-86.912, 33.486],
  [-81.507, 37.427],
  [-76.693, 35.031],
  [-94.255, 33.358],
  [-87.613, 41.74],
  [-71.515, 42.003],
].map((p) => project(p));

export function Banner() {
  const mapScale = 2.3;
  const [mx, my] = [1024 - 487.5 * mapScale, 560 - 305 * mapScale];
  return (
    <AbsoluteFill style={{ background: glow }}>
      <AbsoluteFill style={dots(0.35)} />
      <svg width={2048} height={1152} viewBox="0 0 2048 1152" style={{ position: "absolute" }}>
        <g transform={`translate(${mx} ${my}) scale(${mapScale})`} fill="none" strokeLinejoin="round">
          <path d={STATE_LINES} stroke={colors.landHighlight} strokeWidth={1.1} opacity={0.55} />
          <path d={NATION_EDGE} stroke={colors.landHighlight} strokeWidth={1.4} opacity={0.75} />
          {TOWNS.map(([tx, ty], i) => (
            <circle key={i} cx={tx} cy={ty} r={3.2} fill={colors.accent} opacity={0.75} />
          ))}
        </g>
      </svg>
      {/* Darker behind the name, so the map never competes with it. */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 760px 230px at 50% 50%, ${colors.background}EE 0%, ${colors.background}00 100%)` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 128, letterSpacing: 3, color: colors.text, lineHeight: 1, marginTop: -20 }}>
          EVERYDAY <span style={{ color: colors.accent }}>CASE STUDY</span>
        </div>
        <div style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 40, color: colors.muted, marginTop: 20 }}>How the world really works, one case at a time</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
