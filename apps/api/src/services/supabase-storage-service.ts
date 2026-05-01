import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

let _client: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  return _client;
}

function mediaExtension(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "video/mp4") return "mp4";
  if (m === "audio/mpeg") return "mp3";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/ogg; codecs=opus") return "ogg";
  if (m === "application/pdf") return "pdf";
  return m.split("/")[1]?.split(";")[0]?.trim() ?? "bin";
}

async function storeInPostgres(
  userId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  try {
    const base64Data = buffer.toString("base64");
    const result = await pool.query<{ id: string }>(
      `INSERT INTO media_uploads (user_id, mime_type, filename, data, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, mimeType, filename, base64Data, buffer.length]
    );
    const id = result.rows[0]?.id;
    if (!id) return null;
    const base = env.APP_BASE_URL.replace(/\/$/, "");
    return `${base}/api/media/${id}`;
  } catch (err) {
    console.warn("[SupabaseStorage] storeInPostgres failed", err);
    return null;
  }
}

export async function uploadTemplateHeaderMedia(input: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string | null;
}): Promise<string | null> {
  const ext = mediaExtension(input.mimeType);
  const filename = input.filename?.trim() || `template-header-${Date.now()}.${ext}`;
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const path = `templates/${input.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from(env.SUPABASE_INBOUND_MEDIA_BUCKET)
        .upload(path, input.buffer, { contentType: input.mimeType, upsert: false });
      if (!error) {
        const { data } = supabase.storage.from(env.SUPABASE_INBOUND_MEDIA_BUCKET).getPublicUrl(path);
        return data.publicUrl;
      }
    } catch {
      // fall through to Postgres
    }
  }

  return storeInPostgres(input.userId, input.buffer, input.mimeType, filename);
}

/**
 * Upload inbound media buffer to Supabase Storage (if configured) or fall back
 * to the local Postgres media_uploads table. Returns a publicly accessible URL,
 * or null on failure.
 */
export async function uploadInboundMedia(input: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  folder?: string;
  filename?: string | null;
}): Promise<string | null> {
  const ext = mediaExtension(input.mimeType);
  const filename = input.filename?.trim() || `inbound-${Date.now()}.${ext}`;
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const folder = (input.folder ?? "inbound").replace(/^\/+|\/+$/g, "");
      const path = `${folder}/${input.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from(env.SUPABASE_INBOUND_MEDIA_BUCKET)
        .upload(path, input.buffer, {
          contentType: input.mimeType,
          upsert: false
        });
      if (error) {
        console.warn("[SupabaseStorage] upload failed, falling back to Postgres", error.message);
      } else {
        const { data } = supabase.storage
          .from(env.SUPABASE_INBOUND_MEDIA_BUCKET)
          .getPublicUrl(path);
        return data.publicUrl;
      }
    } catch (err) {
      console.warn("[SupabaseStorage] unexpected error, falling back to Postgres", err);
    }
  }

  return storeInPostgres(input.userId, input.buffer, input.mimeType, filename);
}
