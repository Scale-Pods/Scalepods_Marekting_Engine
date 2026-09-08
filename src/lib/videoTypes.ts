/**
 * The video-treatment library behind Video Studio's type gallery — the moving-image counterpart
 * to `studioStyles.ts`'s STUDIO_STYLES, and deliberately the same shape so the two Studios read
 * as one product.
 *
 * Why this exists: the first real Veo test produced a technically perfect but commercially
 * useless clip (a steaming coffee cup) because nothing constrained WHAT the video should be
 * about — exactly the failure `studioStyles.ts` was written to fix for images. At $0.05–0.40 a
 * second, an aimless prompt is a waste of real money, so the subject matter is now a deliberate
 * choice from a fixed set built around ScalePods' actual business.
 *
 * Every type here is chosen against two constraints that are real, not stylistic:
 *
 *  1. **What Veo is genuinely good at** — cinematic b-roll, people in environments, abstract
 *     motion, macro texture, light and atmosphere.
 *  2. **What Veo is genuinely bad at** — legible on-screen text, real UI, charts, logos, and
 *     keeping one person's face consistent across separately generated shots. Nothing in this
 *     library asks the model for any of those. On-screen words come from the worker's own
 *     `drawtext` overlay (render.js), where they're pixel-exact and spelled correctly, and the
 *     brand logo is burned in the same way — never generated.
 *
 * `direction` is appended to the GPT-written shot description in the n8n brief workflow, so it
 * has to read as cinematography direction on its own — no subject matter, no "a video of…".
 * It's written in Google's own documented Veo prompt vocabulary (Cinematography + Subject +
 * Action + Context + Style & Ambiance — see cloud.google.com's Veo 3.1 prompting guide), because
 * that's the phrasing the model was actually tuned on.
 */

import type { AspectRatio } from './studioStyles'
import type { VideoEngine } from './videoStudio'

export interface VideoTypeDef {
  id: string
  label: string
  /** One-line "when would I pick this" for the tile. */
  bestFor: string
  /** What the sequence is structurally — fed to GPT as the narrative arc to write shots against.
   *  This is the part that makes a multi-shot video a *story* instead of N unrelated clips. */
  arc: string
  /** Cinematography direction appended to every shot's prompt. Camera + lens + light + grade. */
  direction: string
  /** Explicit negative direction. Veo, like the image models, responds far better to being told
   *  what to exclude specifically than to a bare "don't" — see Google's own negative-prompt
   *  guidance ("a desolate landscape with no buildings or roads", not "no man-made structures"). */
  avoid: string
  defaultRatio: AspectRatio
  /** Sensible starting engine for this treatment's quality bar vs. what it costs. */
  defaultEngine: VideoEngine
  /** Shot count this arc is written for. */
  defaultShots: number
  /** Seconds per shot — Veo only accepts 4, 6 or 8. */
  defaultDurationS: 4 | 6 | 8
  /** Whether this treatment reads properly without narration. Types that carry their meaning
   *  visually don't need a VO; ones that are essentially an argument do. */
  wantsVoiceover: boolean
}

const BRAND_GRADE =
  'Colour grade: deep cyber-navy shadows, cool neutral midtones, one warm practical light source for contrast. Restrained, premium, never saturated or candy-coloured.'

const NO_TEXT =
  'on-screen text, captions, subtitles, signage, logos, watermarks, readable UI, charts, dashboards, spreadsheets, gibberish lettering'

export const VIDEO_TYPES: VideoTypeDef[] = [
  {
    id: 'problem-fix',
    label: 'Problem → Fix',
    bestFor: 'The core B2B story: the mess, then the calm',
    arc: 'A two-act contrast. The opening shots establish the friction of the manual way — visible strain, clutter, lateness, repetition. The final shot flips it: the same environment, now composed, quiet and in control. The turn must be legible from the visuals alone, without narration explaining it.',
    direction:
      'Cinematography: handheld with subtle instability in the problem shots, locked-off and steady on a slow push-in for the resolution shot. Composition: medium and close shots, subject off-centre. Lens: 35mm, shallow depth of field. Ambiance: harsh overhead fluorescent and screen-glow in the problem beats, soft directional window light in the resolution beat. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, stock-photo smiling, thumbs up, handshakes, cartoon, 3D render, slow-motion clichés, lens flares`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 3,
    defaultDurationS: 6,
    wantsVoiceover: true,
  },
  {
    id: 'ops-broll',
    label: 'Workplace b-roll',
    bestFor: 'Credible footage behind a strong caption',
    arc: 'A loose observational sequence of real work happening — no story beats, just texture. Each shot is a different angle on the same working environment so the set feels continuous, building from wide context to close detail.',
    direction:
      'Cinematography: slow dolly and gentle tracking moves, never static. Composition: wide establishing, then medium, then close on hands and surfaces. Lens: 35mm and 50mm, shallow depth of field, natural falloff. Ambiance: real office daylight, mixed practical lighting, faint atmospheric haze. Documentary realism, unposed. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, posed corporate stock footage, forced smiles, boardroom applause, cartoon, 3D render`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 3,
    defaultDurationS: 4,
    wantsVoiceover: true,
  },
  {
    id: 'data-flow',
    label: 'Abstract automation',
    bestFor: 'Explaining automation with no people and no text',
    arc: 'An abstract visual metaphor for work moving through a system: scattered and chaotic at the start, resolving into ordered, directional flow by the end. Purely visual — no literal objects, no people.',
    direction:
      'Cinematography: slow continuous camera drift and gentle orbit through the scene. Composition: full-frame abstraction with real depth layers. Lens: macro and wide-angle, heavy bokeh in the foreground. Subject matter: light trails, particulate motion, fine geometric line-work, luminous nodes connecting through dark space, volumetric glow. Ambiance: dark field, controlled bloom, one dominant light source. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, people, hands, faces, recognisable products, cartoon, cheesy sci-fi hologram interfaces, rainbow neon, glitch effects`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 3,
    defaultDurationS: 4,
    wantsVoiceover: true,
  },
  {
    id: 'founder-pov',
    label: 'Founder POV',
    bestFor: 'Personal-voice posts without a consistent face',
    arc: 'A first-person sequence through one continuous moment of work — what the viewer would see if they were doing it themselves. Shots progress through a single task rather than jumping locations.',
    direction:
      'Cinematography: point-of-view and over-the-shoulder framing, subtle handheld movement, camera at eye level. Composition: hands and forearms in frame, the environment beyond them soft. Lens: 28mm wide, shallow depth of field. Ambiance: early-morning or late-evening directional light, warm practical lamp against cool ambient. Faces are out of frame or turned away throughout. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, direct-to-camera faces, identifiable portraits, stock-photo posing, cartoon, 3D render`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 3,
    defaultDurationS: 4,
    wantsVoiceover: true,
  },
  {
    id: 'macro-detail',
    label: 'Macro detail',
    bestFor: 'Premium pattern-break that stops the scroll',
    arc: 'A series of extreme close-ups on the physical texture of work — keys, paper, glass, metal, dust in light. Abstract enough to be unplaceable, concrete enough to feel real. Each shot is a different material.',
    direction:
      'Cinematography: very slow push-in and lateral drift, almost still. Composition: extreme macro filling the frame, razor-thin plane of focus. Lens: macro, dramatic raking light across the surface. Ambiance: dark surround, single hard light source, visible dust motes and micro-detail. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, whole objects, wide shots, people, faces, cartoon, 3D render, plastic-looking CGI`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-lite',
    defaultShots: 3,
    defaultDurationS: 4,
    wantsVoiceover: false,
  },
  {
    id: 'transformation',
    label: 'Time-lapse transformation',
    bestFor: 'Showing scale: manual effort vs. what runs itself',
    arc: 'One environment compressed over time — accumulating mess and motion in the early shots, then the same frame settled and orderly. The camera position stays broadly consistent so the change is the subject.',
    direction:
      'Cinematography: locked-off tripod framing with time-lapse motion inside the frame, subtle parallax only. Composition: consistent wide-to-medium framing across shots so the space is recognisably the same. Lens: 35mm, deep focus. Ambiance: light shifting across the scene as time passes, from cold overhead to warm low-angle. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, wild camera moves, location changes between shots, people looking at camera, cartoon, 3D render`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 3,
    defaultDurationS: 6,
    wantsVoiceover: true,
  },
  {
    id: 'hook-cut',
    label: 'Cinematic hook',
    bestFor: 'A short, high-impact scroll-stopper',
    arc: 'One or two dramatic shots with a single striking image and nothing else — built to arrest attention in the first half-second, not to explain anything. The caption does the explaining.',
    direction:
      'Cinematography: bold decisive camera move — a fast push-in, a sharp crane rise, or a hard tracking move. Composition: strong central or rule-of-thirds framing with real negative space. Lens: anamorphic feel, shallow depth of field. Ambiance: high contrast, deep shadow, one dramatic key light, atmospheric haze. Cinematic and deliberate, never frantic. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, rapid strobing cuts, shaky cam, cartoon, 3D render, cheap action-trailer clichés, lens flares`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 2,
    defaultDurationS: 4,
    wantsVoiceover: false,
  },
  {
    id: 'product-in-context',
    label: 'Product in context',
    bestFor: 'Implying the software without faking the UI',
    arc: 'A device present in a real working environment, treated as an object in a scene rather than a screenshot. Shots move from the room, to the desk, to the glow of the screen — the interface itself always out of focus.',
    direction:
      'Cinematography: slow dolly-in past foreground objects toward the device. Composition: the screen is present but never the focal plane, deliberately defocused. Lens: 50mm, very shallow depth of field, screen glow as a practical light source on nearby surfaces. Ambiance: dim room, cool screen light against a warm lamp, evening. ' +
      BRAND_GRADE,
    avoid: `${NO_TEXT}, sharp readable interfaces, fake dashboards, charts, app screenshots, cartoon, 3D render, floating holograms`,
    defaultRatio: '9:16',
    defaultEngine: 'veo-3.1-fast',
    defaultShots: 3,
    defaultDurationS: 4,
    wantsVoiceover: true,
  },
]

export function getVideoType(id: string | null | undefined): VideoTypeDef | null {
  if (!id) return null
  return VIDEO_TYPES.find((t) => t.id === id) ?? null
}

/** The full direction block n8n appends when writing this type's shot prompts. Kept here rather
 *  than in the workflow so the wording is versioned with the app and shows up in a diff — same
 *  reasoning as `styleDirection()` in studioStyles.ts. */
export function videoTypeDirection(type: VideoTypeDef): string {
  return `${type.direction} Avoid: ${type.avoid}.`
}
