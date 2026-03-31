import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const FLOW_MEDIA_BUCKET = "uploads";

export const supabase = url && key ? createClient(url, key) : null;

/** Upload a file to the flow-media bucket, return the public URL. */
export async function uploadFlowMedia(file: File): Promise<string> {
  if (!supabase) {
    throw new Error("Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(FLOW_MEDIA_BUCKET)
    .upload(path, file, { upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(FLOW_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Upload a chat/inbox media file to Supabase, return public URL + mimeType. */
export async function uploadInboxMedia(file: File): Promise<{ url: string; mimeType: string }> {
  if (!supabase) {
    throw new Error("Supabase not configured.");
  }

  const ext = file.name.split(".").pop() ?? "bin";
  const path = `inbox/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(FLOW_MEDIA_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(FLOW_MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, mimeType: file.type };
}
