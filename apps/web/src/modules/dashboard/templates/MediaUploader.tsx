import { useRef, useState } from "react";
import { useUploadMediaMutation } from "./queries";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_EXT = ".jpg,.jpeg,.png,.webp";
const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  token: string;
  connectionId: string;
  onUploaded: (handle: string) => void;
}

export function MediaUploader({ token, connectionId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadMutation = useUploadMediaMutation(token);

  function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Unsupported file type. Use JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File exceeds 5MB limit.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    uploadMutation.mutate(
      { connectionId, file },
      {
        onSuccess: (handle) => onUploaded(handle),
        onError: (err) => setError((err as Error).message)
      }
    );
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
          overflow: "hidden"
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="Header preview"
            style={{ maxHeight: "120px", borderRadius: "6px", objectFit: "contain" }}
          />
        ) : (
          <>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>🖼️</div>
            <div style={{ fontSize: "13px", color: "#555" }}>
              Drag & drop or <strong>click to upload</strong>
            </div>
            <div style={{ fontSize: "11px", color: "#aaa", marginTop: "4px" }}>
              JPEG, PNG, WebP — max 5MB
            </div>
          </>
        )}
        {uploadMutation.isPending && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.8)",
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
        accept={ACCEPTED_EXT}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {uploadMutation.isSuccess && (
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
