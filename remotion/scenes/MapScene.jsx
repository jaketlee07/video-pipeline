import { geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import us from "us-atlas/counties-albers-10m.json";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BOTTOM_SPACE, colors, fonts } from "../theme.js";
import { Mark, loopPath, seedOf } from "./Scribble.jsx";

// The US map, already projected to a 975×610 plane by us-atlas. Points from
// src/graphics.mjs use the same projection.
const path = geoPath();
const NATION = path(feature(us, us.objects.nation));
const STATE_LINES = path(mesh(us, us.objects.states, (a, b) => a !== b));
const COUNTY_LINES = path(mesh(us, us.objects.counties, (a, b) => a !== b && a.id.slice(0, 2) === b.id.slice(0, 2)));
const SHAPES = new Map(
  [...feature(us, us.objects.states).features, ...feature(us, us.objects.counties).features].map((f) => [f.id, path(f)]),
);
const US_BOX = [0, 0, 975, 610];

const VIEW_W = 1920;
const VIEW_H = 1080 - BOTTOM_SPACE + 40;

function fit([x0, y0, x1, y1]) {
  return { scale: Math.min(VIEW_W / (x1 - x0), VIEW_H / (y1 - y0)), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Starts on the whole country and zooms to the places, which then get pins and labels.
export function MapScene({ map }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const from = fit(US_BOX);
  const to = fit(map.box);
  const p = interpolate(frame, [8, 8 + 1.8 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * p);
  const cx = from.cx + (to.cx - from.cx) * p;
  const cy = from.cy + (to.cy - from.cy) * p;
  const tx = VIEW_W / 2 - cx * scale;
  const ty = VIEW_H / 2 - cy * scale;
  const screen = (pt) => [tx + pt.x * scale, ty + pt.y * scale];
  const settled = 8 + 1.8 * fps;
  const pinIn = (i) => spring({ frame: frame - settled + 6 - i * 6, fps, config: { damping: 14 } });
  const routeDrawn = interpolate(frame, [settled + 10, settled + 10 + fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
  const countyOpacity = interpolate(scale, [3, 8], [0, 1], clamp);
  // A pin's state is tinted on the national view and fades as the camera closes in.
  const stateTint = interpolate(scale, [3, 12], [1, 0], clamp);
  const region = map.style === "region";
  // One or two pinned places also get circled by hand once the pins land.
  const circled = map.style === "pins" && map.points.length <= 2 ? interpolate(frame, [settled + 22, settled + 42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const thin = { fill: "none", vectorEffect: "non-scaling-stroke" };

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <svg width={1920} height={1080}>
        <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
          <path d={NATION} fill={colors.land} />
          {map.states.map((id) => (
            <path
              key={id}
              d={SHAPES.get(id)}
              fill={region ? colors.accent : colors.landHighlight}
              fillOpacity={region ? 0.85 : stateTint}
              stroke={region ? colors.accent : "none"}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {map.counties.map((id) => (
            <path
              key={id}
              d={SHAPES.get(id)}
              fill={region ? colors.accent : colors.landHighlight}
              fillOpacity={region ? 0.85 : 1}
              stroke={colors.accent}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={COUNTY_LINES} stroke="#3E4F74" strokeWidth={1.2} opacity={countyOpacity} {...thin} />
          <path d={STATE_LINES} stroke="#5A6B8F" strokeWidth={2.2} {...thin} />
          <path d={NATION} stroke="#6B7DA3" strokeWidth={2.5} {...thin} />
        </g>
        {map.style === "route" && map.points.length >= 2 && (
          <line
            x1={screen(map.points[0])[0]}
            y1={screen(map.points[0])[1]}
            x2={screen(map.points[0])[0] + (screen(map.points[1])[0] - screen(map.points[0])[0]) * routeDrawn}
            y2={screen(map.points[0])[1] + (screen(map.points[1])[1] - screen(map.points[0])[1]) * routeDrawn}
            stroke={colors.accent}
            strokeWidth={6}
            strokeDasharray="18 14"
            strokeLinecap="round"
          />
        )}
        {map.points.map((pt, i) => {
          const [x, y] = screen(pt);
          // Around the pin and its label together; labels are 40px bold, about 23px a character.
          const labelW = pt.label.length * 23 + 32;
          const cx = x + ((pt.labelLeft ? -1 : 1) * labelW) / 2;
          return <Mark key={`loop${i}`} d={loopPath(cx, y, labelW / 2 + 52, 54, seedOf(pt.label))} progress={circled} color={colors.text} width={5} opacity={0.85} />;
        })}
        {map.points.map((pt, i) => {
          const [x, y] = screen(pt);
          const s = pinIn(i);
          return (
            <g key={i} transform={`translate(${x} ${y})`} opacity={Math.min(1, s)}>
              <circle r={30 * s} fill={colors.accent} opacity={0.25} />
              <circle r={14 * s} fill={colors.accent} stroke={colors.text} strokeWidth={4} />
              <text
                x={pt.labelLeft ? -32 : 32}
                y={13}
                textAnchor={pt.labelLeft ? "end" : "start"}
                fontFamily={fonts.body}
                fontWeight={700}
                fontSize={40}
                fill={colors.text}
                stroke={colors.background}
                strokeWidth={8}
                paintOrder="stroke"
              >
                {pt.label}
              </text>
            </g>
          );
        })}
        {map.labels.map((l, i) => {
          const [x, y] = screen(l);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              fontFamily={fonts.display}
              fontWeight={800}
              fontSize={64}
              fill={colors.text}
              stroke={colors.background}
              strokeWidth={10}
              paintOrder="stroke"
              opacity={pinIn(0)}
            >
              {l.label}
            </text>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
}
