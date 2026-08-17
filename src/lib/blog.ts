import { supabase, fireWebhook } from './supabase'

// Blog module (docs/blog-module.md) — publishes to the separate scalepods.co Next.js site via
// its own /api/blog/publish route, not a social API. BLOG_PUBLISH_ENABLED follows the same
// credit/scope-safety pattern as GENERATION_ENABLED/PUBLISHING_ENABLED in content.ts.
// Flipped true 2026-08-14: the site's /api/blog/publish route is deployed and verified live
// (401 on missing/wrong secret), the 2026-01-01 listing-page filter bug is fixed, and the
// ScalePods · Blog Publish n8n workflow is published.
export const BLOG_PUBLISH_ENABLED = true

/**
 * One section of a post body. Deliberately mirrors exactly what scalepods.co's
 * `website_content.body` (JSON.stringify'd) expects — see docs/blog-module.md. `body` supports
 * only `**bold**` and `[text](url)` inline, plus bullet lines starting with "• " — that's the
 * full markdown subset the site's renderer (BlogBodyClient.tsx) understands. One image SLOT per
 * section (the site schema has no field for more) — but unlike the top-level banner, the site's
 * shared renderer already theme-swaps a section's image for BOTH static and CMS-published posts,
 * so `imageDark`/`imageLight` genuinely work today, no site-side change needed. `image` is the
 * single/fallback form (always shown regardless of theme) — set when only one variant exists;
 * `imageDark`/`imageLight` are set together when both do, and `image` is omitted in that case
 * (matches the site's own `section.image || (dark ? section.imageDark : section.imageLight)`).
 */
export interface BlogSection {
  heading: string
  body: string
  image?: string
  imageDark?: string
  imageLight?: string
  imageCaption?: string
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  category: string
  excerpt: string
  /** Fallback/single banner — what the live site currently renders (its dynamic-post render
   *  path only reads website_content.hero_image, no dark/light split — see docs/blog-module.md).
   *  Kept in sync from banner_url_dark on save so the currently-working single-banner path never
   *  regresses. */
  banner_url: string | null
  /** Dark/light banner variants. Stored today; not yet read by the live site (needs a matching
   *  site-side schema + [slug]/page.tsx change — same category of gap as the CTA fields). */
  banner_url_dark: string | null
  banner_url_light: string | null
  sections: BlogSection[]
  /** Bottom CTA card ("Ready to build your AI workforce? / Deploy Alex, Maya... / Build Your AI
   *  Workforce →"). Not yet read by the live site's WorkflowAuditCTA — it still picks canned
   *  text via keyword-matching the title — see docs/blog-module.md. */
  cta_title: string | null
  cta_subtitle: string | null
  cta_label: string | null
  cta_url: string | null
  status: 'draft' | 'published' | 'failed'
  published_at: string | null
  created_at: string
  updated_at: string
}

/** Categories actually in use on the live site today — free text underneath, these are just
 *  suggestions so new posts stay consistent with the existing look. */
export const BLOG_CATEGORY_SUGGESTIONS = ['AI Automation', 'Article', 'Resources']

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function listBlogPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase.from('blog_posts').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data as BlogPost[]
}

export async function getBlogPost(id: string): Promise<BlogPost | null> {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as BlogPost | null
}

// A post needs at least one usable banner for the live site's single hero_image column, so the
// dark variant (this app's default theme) wins as the fallback when both are set, and either one
// alone works when only one is uploaded.
function resolveFallbackBanner(dark: string | null, light: string | null): string | null {
  return dark ?? light ?? null
}

export async function createBlogPost(input: {
  title: string
  slug: string
  category: string
  excerpt: string
  bannerUrlDark: string | null
  bannerUrlLight: string | null
  sections: BlogSection[]
  ctaTitle: string | null
  ctaSubtitle: string | null
  ctaLabel: string | null
  ctaUrl: string | null
}): Promise<BlogPost> {
  const { data, error } = await supabase
    .from('blog_posts')
    .insert({
      title: input.title,
      slug: input.slug,
      category: input.category,
      excerpt: input.excerpt,
      banner_url: resolveFallbackBanner(input.bannerUrlDark, input.bannerUrlLight),
      banner_url_dark: input.bannerUrlDark,
      banner_url_light: input.bannerUrlLight,
      sections: input.sections,
      cta_title: input.ctaTitle,
      cta_subtitle: input.ctaSubtitle,
      cta_label: input.ctaLabel,
      cta_url: input.ctaUrl,
      status: 'draft',
    })
    .select()
    .single()
  if (error) throw error
  return data as BlogPost
}

export async function updateBlogPost(
  id: string,
  patch: Partial<{
    title: string
    slug: string
    category: string
    excerpt: string
    bannerUrlDark: string | null
    bannerUrlLight: string | null
    sections: BlogSection[]
    ctaTitle: string | null
    ctaSubtitle: string | null
    ctaLabel: string | null
    ctaUrl: string | null
  }>,
): Promise<BlogPost> {
  const bannerFields =
    patch.bannerUrlDark !== undefined || patch.bannerUrlLight !== undefined
      ? {
          banner_url_dark: patch.bannerUrlDark ?? null,
          banner_url_light: patch.bannerUrlLight ?? null,
          banner_url: resolveFallbackBanner(patch.bannerUrlDark ?? null, patch.bannerUrlLight ?? null),
        }
      : {}
  const { data, error } = await supabase
    .from('blog_posts')
    .update({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.excerpt !== undefined ? { excerpt: patch.excerpt } : {}),
      ...bannerFields,
      ...(patch.sections !== undefined ? { sections: patch.sections } : {}),
      ...(patch.ctaTitle !== undefined ? { cta_title: patch.ctaTitle } : {}),
      ...(patch.ctaSubtitle !== undefined ? { cta_subtitle: patch.ctaSubtitle } : {}),
      ...(patch.ctaLabel !== undefined ? { cta_label: patch.ctaLabel } : {}),
      ...(patch.ctaUrl !== undefined ? { cta_url: patch.ctaUrl } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as BlogPost
}

export async function deleteBlogPost(id: string): Promise<void> {
  const { error } = await supabase.from('blog_posts').delete().eq('id', id)
  if (error) throw error
}

/**
 * Fires the sp-blog-publish n8n workflow, which calls the site's POST /api/blog/publish
 * (docs/blog-module.md) and only THEN writes status='published'/published_at back to this row —
 * n8n owns that transition, not the FE. Flipping it here optimistically as soon as the webhook
 * was merely *accepted* would repeat the exact class of bug the scheduling fix addressed
 * earlier: "accepted" and "actually done" are different moments, and the site call can fail
 * (wrong secret, RLS, revalidate error) after n8n's webhook has already returned 200. On
 * failure n8n writes status='failed' instead, so a stuck post is visible rather than silently
 * stuck in limbo. The FE picks up whichever status wins via the existing Realtime subscription
 * on blog_posts (queries.ts) — no polling needed here.
 */
export async function triggerBlogPublish(id: string): Promise<void> {
  if (!BLOG_PUBLISH_ENABLED) {
    throw new Error('Publishing to scalepods.co is not wired up yet — see docs/blog-module.md')
  }
  await fireWebhook('sp-blog-publish', { blogPostId: id })
}
