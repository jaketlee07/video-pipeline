import { Composition } from "remotion";
import { LongForm } from "./LongForm.jsx";

// Props come from src/render.mjs: the scenes with their timing and media.
export const Root = () => (
  <Composition
    id="LongForm"
    component={LongForm}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30}
    defaultProps={{ fps: 30, duration: 1, scenes: [], music: false }}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(props.duration * props.fps)) })}
  />
);
