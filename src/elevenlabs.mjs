// ElevenLabs: text to speech for the narrator, and music for the library in
// media/music/. The API key needs the Text to Speech, Voices (read) and Music
// permissions.
import { loadEnv } from "./env.mjs";

export const VOICE_MODEL = "eleven_v4";
const env = loadEnv();
export const voiceId = env.ELEVENLABS_VOICE_ID;

/**
 * Speaks one paragraph. `previousText`/`nextText` and `previousRequestIds` (up to
 * three, under two hours old) keep the delivery continuous across paragraphs.
 * Returns the MP3, ElevenLabs' request ID, the credits charged, and `alignment`:
 * start and end times in seconds for each character of `text`.
 */
export async function speak({ text, previousText, nextText, previousRequestIds = [] }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: VOICE_MODEL,
      previous_text: previousText || undefined,
      next_text: nextText || undefined,
      previous_request_ids: previousRequestIds.length ? previousRequestIds : undefined,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.detail;
    const message = typeof detail === "string" ? detail : (detail?.message ?? JSON.stringify(json));
    throw new Error(`ElevenLabs ${res.status}${detail?.status ? ` (${detail.status})` : ""}: ${message}`);
  }
  return {
    audio: Buffer.from(json.audio_base64, "base64"),
    alignment: json.alignment,
    requestId: res.headers.get("request-id"),
    credits: Number(res.headers.get("character-cost")) || text.length,
  };
}

export const MUSIC_MODEL = "music_v2_5";

/**
 * Composes an instrumental track from a description. Returns the MP3 and
 * ElevenLabs' ID for the song.
 */
export async function compose({ prompt, seconds }) {
  const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: Math.round(seconds * 1000), model_id: MUSIC_MODEL, force_instrumental: true }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const detail = json?.detail;
    const message = typeof detail === "string" ? detail : (detail?.message ?? JSON.stringify(json));
    throw new Error(`ElevenLabs ${res.status}${detail?.status ? ` (${detail.status})` : ""}: ${message}`);
  }
  return { audio: Buffer.from(await res.arrayBuffer()), songId: res.headers.get("song-id") };
}
