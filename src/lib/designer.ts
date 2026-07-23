import { supabase } from './supabase'

export interface CanvaDesign {
  id: string
  title: string
  thumbnailUrl: string | null
}

/** Opens the Canva Connect OAuth flow in a new tab (PKCE, handled server-side). */
export function connectCanva(): void {
  window.open(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/canva-oauth-start`, '_blank')
}

export async function listCanvaDesigns(): Promise<CanvaDesign[]> {
  const { data, error } = await supabase.functions.invoke('canva-list-designs')
  if (error) throw error
  return (data?.designs ?? []) as CanvaDesign[]
}

export async function importCanvaDesign(designId: string, itemId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('canva-import', { body: { designId, itemId } })
  if (error) throw error
  return data.url as string
}

export async function importFigmaFrame(fileKey: string, nodeId: string, itemId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('figma-import', { body: { fileKey, nodeId, itemId } })
  if (error) throw error
  return data.url as string
}
