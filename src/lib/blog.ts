import { supabase, fireWebhook } from './supabase'

// Blog module (docs/blog-module.md) — publishes to the separate scalepods.co Next.js site via
// its own /api/blog/publish route, not a social API. BLOG_PUBLISH_ENABLED follows the same
// credit/scope-safety pattern as GENERATION_ENABLED/PUBLISHING_ENABLED in content.ts: stays
// false until the site side (API route + the 2026-01-01 listing-page filter bug — see
// docs/blog-module.md) is confirmed ready. Drafting and editing work regardless of this flag;
// only the "push live to the site" step is gated.
export const BLOG_PUBLISH_ENABLED = false

/**
 * One section of a post body. Deliberately mirrors exactly what scalepods.co's
 * `website_content.body` (JSON.stringify'd) expects — see docs/blog-module.md. `body` supports
 * only `**bold**` and `[text](url)` inline, plus bullet lines starting with "• " — that's the
 * full markdown subset the site's renderer (BlogBodyClient.tsx) understands. One image per
 * section (the site schema has no field for more).
 */
export interface BlogSection {
  heading: string
  body: string
  image?: string
  imageCaption?: string
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  category: string
  excerpt: string
  banner_url: string | null
  sections: BlogSection[]
  cta_label: string | null
  cta_url: string | null
  status: 'draft' | 'published'
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

export async function createBlogPost(input: {
  title: string
  slug: string
  category: string
  excerpt: string
  bannerUrl: string | null
  sections: BlogSection[]
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
      banner_url: input.bannerUrl,
      sections: input.sections,
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
    bannerUrl: string | null
    sections: BlogSection[]
    ctaLabel: string | null
    ctaUrl: string | null
  }>,
): Promise<BlogPost> {
  const { data, error } = await supabase
    .from('blog_posts')
    .update({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.excerpt !== undefined ? { excerpt: patch.excerpt } : {}),
      ...(patch.bannerUrl !== undefined ? { banner_url: patch.bannerUrl } : {}),
      ...(patch.sections !== undefined ? { sections: patch.sections } : {}),
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
 * Pushes a post live to scalepods.co via the sp-blog-publish n8n workflow, which calls the
 * site's POST /api/blog/publish (docs/blog-module.md). Gated by BLOG_PUBLISH_ENABLED — see that
 * flag's comment for why. Flips status/published_at locally only after the webhook accepts.
 */
export async function publishBlogPost(id: string): Promise<BlogPost> {
  if (!BLOG_PUBLISH_ENABLED) {
    throw new Error('Publishing to scalepods.co is not wired up yet — see docs/blog-module.md')
  }
  await fireWebhook('sp-blog-publish', { blogPostId: id })
  const { data, error } = await supabase
    .from('blog_posts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as BlogPost
}
