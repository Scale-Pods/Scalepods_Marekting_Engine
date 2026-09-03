/**
 * The visual-treatment library behind the AI Studio's template gallery.
 *
 * Why this exists: the old Content Image Engine had exactly ONE hardcoded art direction
 * ("clean minimalist technical line-art"), which gpt-image-1 renders as washed-out clip-art —
 * that's the whole reason Quick Post's output was rejected. Style is now an explicit choice,
 * and each preset carries real art direction (medium, lighting, composition, and an explicit
 * `avoid` list) rather than one adjective.
 *
 * `promptFragment` is appended to the GPT-written subject line in the n8n brief workflow, so it
 * has to read as art direction on its own — no "a picture of…" phrasing, no subject matter.
 * Keep every fragment model-agnostic: the same text is sent to gpt-image-1 and to Higgsfield.
 */

export interface StudioStyle {
  id: string
  label: string
  /** One-line "when would I pick this" for the tile's hover/subtitle. */
  bestFor: string
  /** Art direction appended to the subject line. Medium + light + composition + palette. */
  promptFragment: string
  /** Explicit negative direction — image models respond far better to being told what to avoid
   *  than to a bare "don't". Folded into the prompt as a trailing "Avoid: …" clause. */
  avoid: string
  /** Ratio this treatment is composed for, used to preselect the ratio picker. */
  defaultRatio: AspectRatio
  /**
   * This treatment is *made of* type — the words are the artwork, not a caption bolted on.
   * The brief workflow reacts to this by naming the exact words to set (the hook it just wrote)
   * and dropping the blanket "no text" rule for this style only.
   *
   * The first version of this file got these two styles wrong: "Bold typographic poster" and
   * "Minimal quote card" both listed `text` under `avoid`, which is self-defeating — it asked
   * for a poster with no writing on it, and the model duly returned wordless flat illustration.
   */
  rendersText?: boolean
  /**
   * A real sample of what this style produces, generated once through this exact pipeline and
   * parked in the `content-media` bucket. Deliberately not a stock image: a tile has to promise
   * the look the model will actually deliver, and a borrowed photo would both misrepresent that
   * and drag someone else's licence into the product.
   */
  thumbnail: string | null
  /** Native Higgsfield Soul style preset, when one matches this treatment better than prompt
   *  text alone. Populated once the Higgsfield credential exists and styles can be enumerated. */
  higgsfieldStyleId?: string
}

/** Ratios shared by the picker, the models, and the preview frame. Values are the literal
 *  strings Higgsfield's `aspect_ratio` accepts, so they pass straight through. */
export const ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9', '4:3', '3:2'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/** Numeric width/height for laying out a preview frame — mirrors PLATFORM_ASPECT in mediaUi. */
export const RATIO_VALUE: Record<AspectRatio, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
}

/** What each platform actually wants, so picking a platform preselects a sane ratio. */
export const PLATFORM_DEFAULT_RATIO: Record<string, AspectRatio> = {
  instagram: '4:5',
  linkedin: '1:1',
  facebook: '1:1',
  youtube: '16:9',
}

const BRAND_PALETTE =
  'Palette: deep cyber-navy #04070D base, sage green #B1D997 as the primary accent, electric blue #63A5E7 sparingly as secondary.'

export const STUDIO_STYLES: StudioStyle[] = [
  {
    id: 'editorial-photo',
    label: 'Editorial photo',
    bestFor: 'Credible, human, business-press feel',
    promptFragment: `Editorial photography, full-frame camera, 35mm lens, shallow depth of field, natural window light with soft falloff, muted desaturated grade, real materials and real textures, generous negative space in the upper third. ${BRAND_PALETTE}`,
    avoid: 'illustration, cartoon, 3D render, clip-art, stock-photo smiling, text, logos, watermarks',
    defaultRatio: '4:5',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/bd371372-3f9f-48fc-bcca-92201bc63c79/1788354104767-0.png',
  },
  {
    id: 'cinematic-portrait',
    label: 'Cinematic portrait',
    bestFor: 'Founder-led or personal-voice posts',
    promptFragment: `Cinematic portrait, 85mm lens, tight key light with deep falloff into shadow, teal-and-warm colour grade, film grain, subject off-centre with clean space beside them. ${BRAND_PALETTE}`,
    avoid: 'flat lighting, illustration, cartoon, clip-art, text, logos, distorted hands or faces',
    defaultRatio: '4:5',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/d381b607-7778-4635-8601-2176c9e274b2/1788354099846-0.png',
  },
  {
    id: 'typographic-poster',
    label: 'Bold typographic poster',
    bestFor: 'One sharp statement that must be read fast',
    promptFragment: `A Swiss-style typographic poster where the lettering IS the artwork and fills most of the frame. Set the words in a heavy geometric sans-serif, tight tracking, ranged left on a strict grid, broken across two or three lines with extreme scale contrast between the key word and the rest. Flat colour fields, generous margins, print-quality flatness, no imagery behind the type beyond a simple shape or rule. ${BRAND_PALETTE}`,
    avoid: 'photography, 3D, gradients, drop shadows, decorative or script fonts, extra words beyond the ones specified, gibberish lettering, clutter',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/a3b7f2bf-6a16-4f4c-b8cf-6f40b52f5374/1788354093661-0.png',
    rendersText: true,
  },
  {
    id: 'data-card',
    label: 'Data card',
    bestFor: 'Leading with a real metric',
    promptFragment: `Clean data-visualisation card built around ONE very large numeral, with thin precise chart geometry supporting it, generous whitespace, subtle 1px rules, dashboard-grade restraint, flat vector rendering. The single figure is the hero; everything else is quiet. ${BRAND_PALETTE}`,
    avoid: 'photography, 3D, skeuomorphism, dense fake dashboards, small unreadable labels, paragraphs of text, gibberish lettering, clip-art',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/5b176b8b-c64f-4bef-beda-5813cc9026b6/1788354071295-0.png',
  },
  {
    id: 'isometric-3d',
    label: '3D isometric',
    bestFor: 'Showing a system or workflow',
    promptFragment: `Isometric 3D render, soft studio lighting, matte clay materials with a single glossy accent, shallow ambient occlusion, objects arranged on a clean plane, generous space above. ${BRAND_PALETTE}`,
    avoid: 'photorealism, harsh specular highlights, cluttered scene, text, logos',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/f0c1195b-1161-404d-b6c3-53bc482fe1f7/1788354092538-0.png',
  },
  {
    id: 'neon-tech',
    label: 'Neon gradient tech',
    bestFor: 'Product / automation energy',
    promptFragment: `Dark technical composition, volumetric glow, thin luminous line-work over deep navy, controlled bloom, crisp high-contrast edges, one focal light source. ${BRAND_PALETTE}`,
    avoid: 'washed-out haze, fog covering the frame, low contrast, cartoon figures, clip-art, text',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/2f6022b4-ac84-42ec-bf0a-a18bf5074da6/1788354077089-0.png',
  },
  {
    id: 'paper-collage',
    label: 'Paper collage',
    bestFor: 'Standing out in a feed of flat graphics',
    promptFragment: `Cut-paper collage, layered matte stock with visible torn edges and real drop shadows, tactile grain, analogue imperfection, bold simple shapes. ${BRAND_PALETTE}`,
    avoid: 'digital gradients, glossy 3D, photography, text, busy layering',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/7efcb0ec-b770-4ea7-a91f-423bdafffff2/1788354941769-0.png',
  },
  {
    id: 'ui-mockup',
    label: 'Product UI mockup',
    bestFor: 'Showing the software itself',
    promptFragment: `Modern dark-mode dashboard UI on a floating device, crisp interface geometry, believable spacing and hierarchy, soft rim light, slight perspective, clean backdrop. ${BRAND_PALETTE}`,
    avoid: 'gibberish dense text, unreadable fake labels, cluttered charts, photography of offices, clip-art',
    defaultRatio: '16:9',
    thumbnail: null,
  },
  {
    id: 'whiteboard-diagram',
    label: 'Whiteboard diagram',
    bestFor: 'Explaining a concept simply',
    promptFragment: `Hand-drawn explanatory diagram, confident marker strokes, boxes and arrows, deliberate imperfection, plenty of breathing room, two-colour discipline. ${BRAND_PALETTE}`,
    avoid: 'childish doodles, cartoon characters, stick figures, clip-art, dense text, photography',
    defaultRatio: '16:9',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/319abebc-c89f-423f-90b0-9d9c999e3d13/1788354098000-0.png',
  },
  {
    id: 'gradient-mesh',
    label: 'Gradient mesh',
    bestFor: 'A backdrop when the caption carries the message',
    promptFragment: `Abstract gradient mesh, smooth colour transitions, soft organic forms, fine noise texture, no focal subject, deliberately calm and text-safe across the whole frame. ${BRAND_PALETTE}`,
    avoid: 'subjects, figures, objects, text, logos, harsh banding',
    defaultRatio: '1:1',
    thumbnail: null,
  },
  {
    id: 'split-before-after',
    label: 'Split before / after',
    bestFor: 'Contrast: the old way vs the Pod',
    promptFragment: `Split composition, hard vertical divide, visually distinct treatment either side — cluttered and desaturated on the left, ordered and accented on the right, symmetrical framing. ${BRAND_PALETTE}`,
    avoid: 'text labels, arrows, clip-art, cartoon figures, uneven or tilted divide',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/1fdeff34-d3a0-48cf-bcdc-9f8c49a3c93f/1788354771490-0.png',
  },
  {
    id: 'flat-vector',
    label: 'Flat vector',
    bestFor: 'Clean explanatory illustration',
    promptFragment: `Sophisticated flat vector illustration, confident geometric shapes, limited palette, deliberate asymmetric composition, no outlines, generous negative space, editorial-illustration quality. ${BRAND_PALETTE}`,
    avoid: 'clip-art, corporate-memphis figures, generic blob people, thin outline icons, text',
    defaultRatio: '1:1',
    thumbnail: null,
  },
  {
    id: 'macro-texture',
    label: 'Macro texture',
    bestFor: 'Abstract, premium, pattern-breaking',
    promptFragment: `Extreme macro photography, razor-thin depth of field, dramatic raking light, rich material detail filling the frame, abstract and unplaceable. ${BRAND_PALETTE}`,
    avoid: 'recognisable objects, people, illustration, 3D render, text',
    defaultRatio: '1:1',
    thumbnail: 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/content-media/studio/f279bb64-fa89-4f3f-8d73-8da3ca21c356/1788354276900-0.png',
  },
  {
    id: 'risograph',
    label: 'Risograph print',
    bestFor: 'Warm, editorial, human',
    promptFragment: `Risograph print aesthetic, two-colour spot inks with visible misregistration, coarse halftone dot texture, matte uncoated paper, bold simplified forms. ${BRAND_PALETTE}`,
    avoid: 'photorealism, smooth gradients, 3D render, more than three colours, text',
    defaultRatio: '1:1',
    thumbnail: null,
  },
  {
    id: 'quote-card',
    label: 'Minimal quote card',
    bestFor: 'A line worth framing',
    promptFragment: `An extremely minimal quote card: the words set small-to-medium in a refined sans-serif, centred in a vast empty field with gallery-like margins, one thin rule or small graphic mark as the only other element. Restraint is the whole point — the emptiness around the words is the design. Flat matte finish. ${BRAND_PALETTE}`,
    avoid: 'busy detail, photography, 3D, multiple focal points, decorative script, extra words beyond the ones specified, gibberish lettering',
    defaultRatio: '1:1',
    thumbnail: null,
    rendersText: true,
  },
]

export function getStyle(id: string | null | undefined): StudioStyle | null {
  if (!id) return null
  return STUDIO_STYLES.find((s) => s.id === id) ?? null
}

/** Full art direction for a style — what n8n appends to the GPT-written subject line. Kept here
 *  (not in the workflow) so the wording is versioned with the app and reviewable in a diff. */
export function styleDirection(style: StudioStyle): string {
  return `${style.promptFragment} Avoid: ${style.avoid}.`
}
