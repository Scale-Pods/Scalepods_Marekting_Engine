import { supabase } from './supabase'

/** Shared upload helper for the blog composer's image slots (banner and section images —
 *  RichTextEditor.tsx and SectionImageNode.tsx both use this) so there's one place that owns
 *  the storage bucket/path convention. */
export async function uploadBlogImage(file: File, pathPrefix: string): Promise<string> {
  const path = `${pathPrefix}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('content-media').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('content-media').getPublicUrl(path)
  return data.publicUrl
}
