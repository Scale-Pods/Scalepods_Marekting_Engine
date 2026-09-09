#!/usr/bin/env node
// ============================================================================
// Carousel Studio — audio.js (Video Studio: voiceover + music generation)
// ============================================================================
// Why a separate audio layer exists at all:
//
// Veo generates every shot independently, with no memory of the others. Its
// native audio is therefore per-shot — three shots give three unrelated room
// tones that jump at every cut. That audio is still worth keeping (it is real,
// already paid for, and carries the SFX/ambience of each scene), but it cannot
// carry a video on its own.
//
// So the continuity comes from tracks generated ONCE for the whole finished
// video and laid across it: an optional voiceover and an optional music bed.
// A continuous music bed also masks the shot-to-shot ambience jumps, which is
// the real fix for the discontinuity rather than a cosmetic patch.
//
// Both run on the SAME Gemini endpoint and the SAME GEMINI_API_KEY the video
// generation already uses — no additional vendor, no additional credential.
// ============================================================================

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Voiceover: Gemini TTS. Flash tier — narration for a 20-second social video does not need the
// Pro model, and the price difference is real (Pro is 2x).
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
// Music: Lyria. The clip model returns exactly 30s, which comfortably covers the short-form
// videos this studio makes and costs half what the full-song model does.
const MUSIC_MODEL = 'lyria-3-clip-preview';

// Gemini TTS returns raw PCM, documented as 24kHz mono 16-bit.
const PCM_SAMPLE_RATE = 24000;
const PCM_CHANNELS = 1;
const PCM_BITS = 16;

/**
 * All 30 prebuilt Gemini voices, with Google's own one-word characteristic for each
 * (ai.google.dev/gemini-api/docs/speech-generation). Kept as the vendor states them rather than
 * re-described here — an invented description of how a voice sounds is worse than none.
 *
 * Mirrored in src/lib/videoStudio.ts's VOICE_OPTIONS; this copy is what validates an incoming
 * request, so an unknown voice falls back to the default instead of erroring a paid job.
 */
const VOICES = {
  Zephyr: 'Bright', Puck: 'Upbeat', Charon: 'Informative', Kore: 'Firm',
  Fenrir: 'Excitable', Leda: 'Youthful', Orus: 'Firm', Aoede: 'Breezy',
  Callirrhoe: 'Easy-going', Autonoe: 'Bright', Enceladus: 'Breathy', Iapetus: 'Clear',
  Umbriel: 'Easy-going', Algieba: 'Smooth', Despina: 'Smooth', Erinome: 'Clear',
  Algenib: 'Gravelly', Rasalgethi: 'Informative', Laomedeia: 'Upbeat', Achernar: 'Soft',
  Alnilam: 'Firm', Schedar: 'Even', Gacrux: 'Mature', Pulcherrima: 'Forward',
  Achird: 'Friendly', Zubenelgenubi: 'Casual', Vindemiatrix: 'Gentle', Sadachbia: 'Lively',
  Sadaltager: 'Knowledgeable', Sulafat: 'Warm',
};
const DEFAULT_VOICE = 'Charon';

/** The line every voice reads for its preview. On-brand, one sentence, and long enough to hear
 *  pacing and warmth rather than just timbre. */
const SAMPLE_LINE = 'Manual work does not scale. Here is what we automated instead.';

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on this worker — audio generation is unavailable.');
  return key;
}

/**
 * Pulls base64 audio out of an Interactions API response.
 *
 * Deliberately tolerant rather than reading one hard-coded path: this endpoint is newer than the
 * rest of what this worker calls, and the last time a request shape was taken straight from a
 * docs example it was wrong in a way that only surfaced as a paid failure (durationSeconds had to
 * be a number, not the quoted string the docs printed). So this walks the whole response for the
 * first plausible audio payload, and if it finds none it throws with the actual body attached, so
 * the real shape shows up in the job error instead of being guessed at.
 */
function extractAudioBase64(body) {
  const seen = new Set();
  const stack = [body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    const candidates = [
      node.data,
      node.audioData,
      node.inlineData && node.inlineData.data,
      node.inline_data && node.inline_data.data,
      node.output_audio && node.output_audio.data,
      node.outputAudio && node.outputAudio.data,
    ];
    for (const c of candidates) {
      // Real audio is never a short string; this filters out ids, mime types and enum values
      // that would otherwise look like a match.
      if (typeof c === 'string' && c.length > 1024) return c;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  throw new Error('No audio found in response: ' + JSON.stringify(body).slice(0, 800));
}

async function callInteractions(payload, what) {
  const res = await fetch(API_BASE + '/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    // Same error classification the video path uses (veo.js's classifyVeoError), so a billing
    // failure on audio surfaces to the user as "add credits" rather than raw Google JSON.
    if (res.status === 429 || /RESOURCE_EXHAUSTED|quota|billing/i.test(text)) {
      throw new Error('QUOTA_EXCEEDED: ' + what + ' — ' + text);
    }
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|PERMISSION_DENIED/i.test(text)) {
      throw new Error('AUTH_FAILED: ' + what + ' — ' + text);
    }
    throw new Error(what + ' failed (' + res.status + '): ' + text);
  }
  return res.json();
}

/** Minimal RIFF/WAVE header so raw PCM lands on disk as a normal file, rather than something
 *  whose format has to be re-described on the ffmpeg command line every time it is touched. */
function pcmToWav(pcm) {
  const byteRate = (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS) / 8;
  const blockAlign = (PCM_CHANNELS * PCM_BITS) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Narration for the whole finished video, generated once so it runs continuously across every
 * cut. Style and pace are steered in plain language, because Gemini TTS takes direction in the
 * prompt itself rather than through separate parameters.
 */
async function generateVoiceover({ script, voice, outfile }) {
  const chosen = VOICES[voice] ? voice : DEFAULT_VOICE;
  const directed =
    'Read the following as a confident, unhurried voiceover for a short B2B marketing video. ' +
    'Even pace, natural pauses at the punctuation, no hard sell and no announcer energy. ' +
    'Read only the text itself, do not describe it:\n\n' + script;

  const body = await callInteractions({
    model: TTS_MODEL,
    input: directed,
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: chosen }] },
  }, 'Voiceover generation');

  const pcm = Buffer.from(extractAudioBase64(body), 'base64');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, pcmToWav(pcm));
  return outfile;
}

/**
 * An instrumental bed for the whole video. Lyria returns 44.1kHz stereo; the clip model is a
 * fixed 30 seconds, which covers this studio's videos with room to spare — the assembly step
 * trims it down to the real video length.
 */
async function generateMusic({ prompt, outfile }) {
  const directed = prompt +
    '. Instrumental only, no vocals and no lyrics. Consistent throughout with no abrupt changes, ' +
    'mixed to sit underneath a spoken voiceover rather than in front of it.';

  const body = await callInteractions({
    model: MUSIC_MODEL,
    input: directed,
    response_format: { type: 'audio' },
  }, 'Music generation');

  const audio = Buffer.from(extractAudioBase64(body), 'base64');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, audio);
  return outfile;
}

// Real price, confirmed against ai.google.dev/gemini-api/docs/pricing (2026-09-09). Voiceover is
// token-priced and works out to a fraction of a cent for a short script, so it is treated as
// effectively free next to the video; music has a real flat per-song price worth surfacing.
const MUSIC_COST_USD = 0.04;

/**
 * One short sample per voice, used by the picker so a voice can be heard before it is chosen.
 *
 * Generated once and then served as a static public file forever — not synthesised per click,
 * which would both add a wait to every preview and pay repeatedly for identical audio. The whole
 * set is ~30 very short TTS calls, a fraction of a cent in total.
 *
 * `existing` is the set of voice ids already in storage, so a re-run only fills the gaps and
 * costs nothing for what is already there.
 */
async function generateVoiceSample({ voice, outfile }) {
  const chosen = VOICES[voice] ? voice : DEFAULT_VOICE;
  const body = await callInteractions({
    model: TTS_MODEL,
    input: 'Read this naturally, as a voiceover for a short business video:\n\n' + SAMPLE_LINE,
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: chosen }] },
  }, 'Voice sample for ' + chosen);

  const pcm = Buffer.from(extractAudioBase64(body), 'base64');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(outfile, pcmToWav(pcm));
  return outfile;
}

module.exports = {
  generateVoiceover, generateMusic, generateVoiceSample,
  VOICES, DEFAULT_VOICE, MUSIC_COST_USD, SAMPLE_LINE,
};
