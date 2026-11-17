import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme.js";
import { Backdrop } from "./Backdrop.jsx";

// Simple line icons on a 64×64 grid, drawn in the card's text color. Functions,
// since Remotion's bundle only provides React once rendering starts.
const ICONS = {
  person: () => (
    <>
      <circle cx="32" cy="20" r="10" />
      <path d="M14 54c0-12 8-19 18-19s18 7 18 19" />
    </>
  ),
  household: () => (
    <>
      <path d="M8 30 32 11l24 19" />
      <path d="M15 26v28h34V26" />
      <path d="M27 54V40h10v14" />
    </>
  ),
  store: () => (
    <>
      <path d="M10 24h44l-5-12H15z" />
      <path d="M14 24v30h36V24" />
      <path d="M21 54V38h10v16" />
      <path d="M37 34h8v9h-8z" />
    </>
  ),
  government: () => (
    <>
      <path d="M8 22 32 9l24 13z" />
      <path d="M15 27v21M25 27v21M39 27v21M49 27v21" />
      <path d="M8 53h48" />
    </>
  ),
  bank: () => (
    <>
      <path d="M8 22 32 9l24 13z" />
      <path d="M15 27v21M49 27v21" />
      <path d="M8 53h48" />
      <path d="M37 31c-1-2-3-3-5-3-3 0-5 2-5 4s2 3 5 4 5 2 5 4-2 4-5 4c-2 0-4-1-5-3M32 26v22" />
    </>
  ),
  company: () => (
    <>
      <path d="M18 54V10h28v44" />
      <path d="M25 18h4M35 18h4M25 27h4M35 27h4M25 36h4M35 36h4" />
      <path d="M29 54v-8h6v8M12 54h40" />
    </>
  ),
  investor: () => (
    <>
      <path d="M10 10v44h46" />
      <path d="M16 46l10-12 8 6 16-20" />
      <path d="M41 20h9v9" />
    </>
  ),
  factory: () => (
    <>
      <path d="M8 54V30l13 8v-8l13 8v-8l13 8V12h8v42z" />
      <path d="M16 46h5M28 46h5M40 46h5" />
    </>
  ),
  building: () => (
    <>
      <path d="M14 54V16h36v38" />
      <path d="M21 24h6M37 24h6M21 33h6M37 33h6" />
      <path d="M28 54V42h8v12M8 54h48" />
    </>
  ),
  truck: () => (
    <>
      <path d="M5 18h33v27H5z" />
      <path d="M38 27h11l9 10v8H38" />
      <circle cx="15" cy="48" r="5" />
      <circle cx="47" cy="48" r="5" />
    </>
  ),
};

const ROW_Y = 540;
const CARD_H = 220;
// How far arcs may rise above the cards (clear of the title) or dip below them
// (clear of the player controls).
const MAX_UP = 250;
const MAX_DOWN = 260;
const KIND_COLOR = { money: colors.accent, goods: colors.accent2, people: colors.accent2, blocked: colors.danger };

const point = ([sx, sy], [cx, cy], [ex, ey], t) => [
  (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * ex,
  (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ey,
];

// Card width for a row of n parties.
const cardWidth = (n) => (n >= 5 ? 300 : 330);

// Where each party's card sits: one row, spaced to fill the frame without
// running off its edges.
function layout(parties) {
  const n = parties.length;
  const spacing = Math.min([0, 0, 760, 590, 480, 400][n] ?? 400, (1820 - cardWidth(n)) / Math.max(1, n - 1));
  return new Map(parties.map((p, i) => [p.id, { index: i, x: 960 - (spacing * (n - 1)) / 2 + i * spacing }]));
}

// The box a move's label takes up, centred on its arc's apex.
function labelBox(move, [x, y]) {
  const width = Math.max(move.label.length * 15 + (move.kind === "blocked" ? 70 : 50), (move.amount?.length ?? 0) * 21 + 50);
  const height = move.amount ? 92 : 54;
  return { x0: x - width / 2, x1: x + width / 2, y0: y - height / 2, y1: y + height / 2 };
}
const overlaps = (a, b) => a.x0 < b.x1 + 12 && b.x0 < a.x1 + 12 && a.y0 < b.y1 + 8 && b.y0 < a.y1 + 8;

// Each move is an arc: left to right over the top of the cards, right to left
// under them. An arc whose label would land on an earlier label or the title rises
// (or dips) further until it's clear, and switches to the other side of the cards
// if that side is full.
function arcs(moves, places, title) {
  const boxes = [{ x0: 100, x1: 140 + title.length * 30, y0: 40, y1: 165 }];
  return moves.map((move) => {
    const a = places.get(move.from);
    const b = places.get(move.to);
    const right = a.x < b.x;
    const shape = (up, height) => {
      const y = up ? ROW_Y - CARD_H / 2 : ROW_Y + CARD_H / 2;
      const start = [a.x + (right ? 60 : -60), y];
      const end = [b.x + (right ? -60 : 60), y];
      const control = [(start[0] + end[0]) / 2, y + (up ? -2 : 2) * height];
      const apex = point(start, control, end, 0.5);
      return { start, end, control, apex, box: labelBox(move, apex) };
    };
    const base = 95 + 55 * (Math.abs(a.index - b.index) - 1);
    const tries = [];
    for (const up of [right, !right]) {
      const max = up ? MAX_UP : MAX_DOWN;
      for (let h = Math.min(max, base); ; h = Math.min(max, h + 30)) {
        tries.push(shape(up, h));
        if (h === max) break;
      }
    }
    const arc = tries.find((t) => !boxes.some((box) => overlaps(box, t.box))) ?? tries[0];
    boxes.push(arc.box);
    const samples = Array.from({ length: 41 }, (_, i) => point(arc.start, arc.control, arc.end, i / 40));
    const length = samples.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - samples[i - 1][0], p[1] - samples[i - 1][1]) : 0), 0);
    return { ...move, start: arc.start, end: arc.end, control: arc.control, apex: arc.apex, length };
  });
}

function Arrowhead({ arc, color, opacity }) {
  const [ex, ey] = arc.end;
  const angle = Math.atan2(ey - arc.control[1], ex - arc.control[0]);
  const side = (a) => [ex - 26 * Math.cos(a), ey - 26 * Math.sin(a)];
  const [l, r] = [side(angle - 0.45), side(angle + 0.45)];
  return <path d={`M${ex} ${ey}L${l[0]} ${l[1]}L${r[0]} ${r[1]}Z`} fill={color} opacity={opacity} />;
}

// Who pays whom: the parties appear, then each move draws in turn, with coins
// (or dots, for goods and people) travelling along it.
export function Flow({ flow }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const places = layout(flow.parties);
  const moves = arcs(flow.moves, places, flow.title);
  const START = 18;
  const step = Math.max(1.2 * fps, Math.min(3 * fps, (durationInFrames - START - 1.5 * fps) / moves.length));
  const appear = (i) => START + i * step;
  const shown = moves.filter((_, i) => frame >= appear(i));
  const latest = shown.at(-1);
  const titleIn = spring({ frame, fps, config: { damping: 200 } });

  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 120, top: 64, opacity: titleIn }}>
        <div style={{ width: interpolate(titleIn, [0, 1], [0, 120]), height: 8, borderRadius: 4, background: colors.accent, marginBottom: 18 }} />
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 64, lineHeight: 1, color: colors.text, textTransform: "uppercase", letterSpacing: 1 }}>
          {flow.title}
        </div>
      </div>

      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {moves.map((arc, i) => {
          const drawn = interpolate(frame, [appear(i), appear(i) + 0.7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.cubic),
          });
          if (!drawn) return null;
          const color = KIND_COLOR[arc.kind];
          const blocked = arc.kind === "blocked";
          const d = `M${arc.start[0]} ${arc.start[1]}Q${arc.control[0]} ${arc.control[1]} ${arc.end[0]} ${arc.end[1]}`;
          const flowing = frame - appear(i) - 0.7 * fps;
          return (
            <g key={i}>
              {blocked ? (
                <path d={d} fill="none" stroke={color} strokeWidth={6} strokeDasharray="16 14" opacity={drawn} />
              ) : (
                <path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" strokeDasharray={arc.length} strokeDashoffset={arc.length * (1 - drawn)} />
              )}
              <Arrowhead arc={arc} color={color} opacity={drawn >= 1 ? 1 : 0} />
              {!blocked &&
                flowing > 0 &&
                [0, 1, 2].map((k) => {
                  const t = (flowing / (1.6 * fps) + k / 3) % 1;
                  const [x, y] = point(arc.start, arc.control, arc.end, t);
                  const fade = Math.min(1, t * 8, (1 - t) * 8);
                  return arc.kind === "money" ? (
                    <g key={k} transform={`translate(${x} ${y})`} opacity={fade}>
                      <circle r={17} fill={colors.accent} stroke={colors.background} strokeWidth={3} />
                      <text y={7} textAnchor="middle" fontFamily={fonts.body} fontWeight={800} fontSize={20} fill={colors.ink}>
                        $
                      </text>
                    </g>
                  ) : (
                    <circle key={k} cx={x} cy={y} r={11} fill={colors.accent2} stroke={colors.background} strokeWidth={3} opacity={fade} />
                  );
                })}
            </g>
          );
        })}
      </svg>

      {flow.parties.map((party, i) => {
        const { x } = places.get(party.id);
        const CARD_W = cardWidth(flow.parties.length);
        const pop = spring({ frame: frame - i * 4, fps, config: { damping: 14, mass: 0.6 } });
        const active = latest && (latest.from === party.id || latest.to === party.id);
        const edge = active ? KIND_COLOR[latest.kind] : colors.line;
        return (
          <div
            key={party.id}
            style={{
              position: "absolute",
              left: x - CARD_W / 2,
              top: ROW_Y - CARD_H / 2,
              width: CARD_W,
              height: CARD_H,
              boxSizing: "border-box",
              padding: "18px 16px",
              borderRadius: 18,
              background: colors.panel,
              border: `4px solid ${edge}`,
              boxShadow: "0 18px 40px rgba(0, 0, 0, 0.35)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              opacity: Math.min(1, pop),
              transform: `scale(${interpolate(pop, [0, 1], [0.8, 1])})`,
            }}
          >
            <svg width={72} height={72} viewBox="0 0 64 64" fill="none" stroke={colors.text} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
              {(ICONS[party.icon] ?? ICONS.building)()}
            </svg>
            <div style={{ marginTop: 10, fontFamily: fonts.body, fontWeight: 700, fontSize: party.label.length > 18 ? 29 : 33, lineHeight: 1.15, color: colors.text }}>
              {party.label}
            </div>
            {party.note && <div style={{ marginTop: 6, fontFamily: fonts.body, fontWeight: 500, fontSize: 22, color: colors.muted }}>{party.note}</div>}
          </div>
        );
      })}

      {/* Each move's label sits on the top (or bottom) of its arc. */}
      {moves.map((arc, i) => {
        const p = spring({ frame: frame - appear(i) - 0.45 * fps, fps, config: { damping: 200 } });
        if (frame < appear(i)) return null;
        const color = KIND_COLOR[arc.kind];
        return (
          <AbsoluteFill key={i} style={{ pointerEvents: "none" }}>
            <div
              style={{
                position: "absolute",
                left: arc.apex[0],
                top: arc.apex[1],
                transform: `translate(-50%, -50%) scale(${interpolate(p, [0, 1], [0.85, 1])})`,
                opacity: p,
                padding: "8px 20px",
                borderRadius: 14,
                background: colors.background,
                border: `3px solid ${color}`,
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 28, color: colors.text }}>
                {arc.kind === "blocked" && <span style={{ color }}>✕ </span>}
                {arc.label}
              </div>
              {arc.amount && <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 40, lineHeight: 1.1, color }}>{arc.amount}</div>}
            </div>
          </AbsoluteFill>
        );
      })}
    </Backdrop>
  );
}
