import { useRef, useState } from "react";
import { uploadTemplateMedia } from "../../../lib/api";

type MediaType = "IMAGE" | "VIDEO" | "DOCUMENT";

interface Props {
  token: string;
  connectionId: string;
  mediaType: MediaType;
  onUploaded: (url: string, localPreviewUrl?: string) => void;
}

const CONFIG: Record<MediaType, { accept: string; exts: string; maxMb: number; icon: string; label: string }> = {
  IMAGE:    { accept: "image/jpeg,image/png,image/webp,image/gif", exts: ".jpg,.jpeg,.png,.webp,.gif", maxMb: 5,  icon: "🖼️", label: "Image"    },
  VIDEO:    { accept: "video/mp4,video/3gpp,video/quicktime",      exts: ".mp4,.3gp,.mov",           maxMb: 16, icon: "🎬", label: "Video"    },
  DOCUMENT: { accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain", exts: ".pdf,.doc,.docx,.xls,.xlsx,.txt", maxMb: 10, icon: "📄", label: "Document" }
};

export function MediaUploader({ token, connectionId, mediaType, onUploaded }: Props) {
  const cfg = CONFIG[mediaType];
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploaded(false);

    const maxBytes = cfg.maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File exceeds ${cfg.maxMb}MB limit.`);
      return;
    }

    // Preview
    let localPreviewUrl: string | undefined;
    if (mediaType === "IMAGE") {
      localPreviewUrl = URL.createObjectURL(file);
      setPreview(localPreviewUrl);
      setPreviewName(null);
    } else {
      setPreview(null);
      setPreviewName(file.name);
    }

    setUploading(true);
    try {
      const uploaded = await uploadTemplateMedia(token, connectionId, file);
      onUploaded(uploaded.handle, localPreviewUrl);
      setUploaded(true);
    } catch (err) {
      setError((err as Error).message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        style={{
          border: "2px dashed #d1d5db",
          borderRadius: "10px",
          padding: "24px",
          textAlign: "center",
          cursor: "pointer",
          background: "#fafafa",
          position: "relative",
          overflow: "hidden",
          minHeight: "96px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="Header preview"
            style={{ maxHeight: "120px", borderRadius: "6px", objectFit: "contain" }}
          />
        ) : previewName ? (
          <div style={{ fontSize: "13px", color: "#333", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "28px" }}>{cfg.icon}</span>
            <span>{previewName}</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
            <div style={{ fontSize: "28px" }}>{cfg.icon}</div>
            <div style={{ fontSize: "13px", color: "#555" }}>
              Drag & drop or <strong>click to upload</strong>
            </div>
            <div style={{ fontSize: "11px", color: "#aaa" }}>
              {cfg.label} — max {cfg.maxMb}MB ({cfg.exts})
            </div>
          </div>
        )}

        {uploading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: 600,
              color: "#25d366"
            }}
          >
            Uploading...
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={cfg.accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {uploaded && (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>
          ✓ Uploaded successfully
        </div>
      )}
      {error && (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>{error}</div>
      )}
    </div>
  );
}
