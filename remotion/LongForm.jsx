import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Backdrop } from "./scenes/Backdrop.jsx";
import { BigNumber } from "./scenes/BigNumber.jsx";
import { Chart } from "./scenes/Chart.jsx";
import { Document } from "./scenes/Document.jsx";
import { Flow } from "./scenes/Flow.jsx";
import { Footage } from "./scenes/Footage.jsx";
import { MapScene } from "./scenes/MapScene.jsx";
import { TitleCard } from "./scenes/TitleCard.jsx";
import { colors } from "./theme.js";

function Scene({ scene }) {
  switch (scene.kind) {
    case "footage":
      return <Footage media={scene.media} seed={scene.id} />;
    case "flow":
      return <Flow flow={scene.flow} />;
    case "document":
      return <Document document={scene.document} />;
    case "chart":
      return <Chart chart={scene.chart} />;
    case "number":
      return <BigNumber number={scene.number} backdrop={scene.backdrop} seed={scene.id} />;
    case "map":
      return <MapScene map={scene.map} />;
    // Left empty for YouTube's end screen elements.
    case "end":
      return <Backdrop />;
    default:
      return <TitleCard title={scene.title} backdrop={scene.backdrop} seed={scene.id} />;
  }
}

// No burned-in captions: YouTube shows the .srt that src/render.mjs writes. The
// music (src/music.mjs) is already at its level, ducked under the narration.
export const LongForm = ({ scenes, music }) => (
  <AbsoluteFill style={{ backgroundColor: colors.background }}>
    {scenes.map((scene) => (
      <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames} premountFor={30} name={`${scene.id} ${scene.kind}`}>
        <Scene scene={scene} />
      </Sequence>
    ))}
    <Audio src={staticFile("narration.wav")} />
    {music && <Audio src={staticFile("music.wav")} />}
  </AbsoluteFill>
);
