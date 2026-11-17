// The channel's look: one palette and one font pair, used by every scene. Change
// them here and every video follows.
import { loadFont as loadBarlowCondensed } from "@remotion/google-fonts/BarlowCondensed";
import { loadFont as loadIBMPlexMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSourceSerif } from "@remotion/google-fonts/SourceSerif4";

export const fonts = {
  // Headlines, big numbers and chart values.
  display: loadBarlowCondensed("normal", { weights: ["600", "800"], subsets: ["latin"] }).fontFamily,
  // Captions, labels and quotes.
  body: loadInter("normal", { weights: ["500", "600", "700"], subsets: ["latin"] }).fontFamily,
  // The text of documents shown on screen, and their source links.
  serif: loadSourceSerif("normal", { weights: ["400", "600", "700"], subsets: ["latin"] }).fontFamily,
  mono: loadIBMPlexMono("normal", { weights: ["500"], subsets: ["latin"] }).fontFamily,
};

export const colors = {
  background: "#0E1420",
  panel: "#18223A",
  land: "#1A2438",
  landHighlight: "#2A3B62",
  line: "#33415E",
  text: "#F3EFE6",
  muted: "#97A3B6",
  accent: "#FFB547",
  accent2: "#4FC1B0",
  // Flows that stop or are blocked.
  danger: "#E5604D",
  // Documents: off-white paper, dark ink, and a highlighter.
  paper: "#F4F0E6",
  ink: "#1B2233",
  inkMuted: "#5E6678",
  marker: "rgba(255, 181, 71, 0.55)",
};

// Kept clear at the bottom of the frame, where YouTube's player controls and
// closed captions sit.
export const BOTTOM_SPACE = 120;
