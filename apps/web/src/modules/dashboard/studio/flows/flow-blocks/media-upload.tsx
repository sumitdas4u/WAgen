import { useRef, useState } from "react";
import { uploadFlowMedia } from "../../../../../lib/supabase";

type MediaType = "image" | "video" | "document" | "audio";

const ACCEPT: Record<MediaType, string> = {
  image: "image/*",
  video: "video/*",
  document: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip",
  audio: "audio/*"
};

const MAX_BYTES: Record<MediaType, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  audio: 20 * 1024 * 1024
};

interface MediaUploadProps {
  mediaType: MediaType;
  onUrl: (url: string) => void;
  currentUrl?: string;
}

export function MediaUpload({ mediaType, onUrl, currentUrl }: MediaUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const maxBytes = MAX_BYTES[mediaType];
    if (file.size > maxBytes) {
      setError(`Max size ${maxBytes / 1024 / 1024} MB`);
      return;
    }
    setError(null);
    setUploading(true);
    setFileName(file.name);
    try {
      const url = await uploadFlowMedia(file);
      onUrl(url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed");
      setFileName(null);
    } finally {
      setUploading(false);
    }
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
    // Reset so the same file can be selected again.
    event.target.value = "";
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      void handleFile(file);
    }
  };

  const displayName = fileName ?? (currentUrl ? decodeURIComponent(currentUrl.split("/").pop() ?? "") : null);

  return (
    <div
      className={`fn-media-upload nodrag${uploading ? " uploading" : ""}`}
      onDrop={onDrop}
      onDragOver={(event) => event.preventDefault()}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[mediaType]}
        style={{ display: "none" }}
        onChange={onInputChange}
      />
      {uploading ? (
        <span className="fn-upload-status uploading">Uploading...</span>
      ) : displayName ? (
        <span className="fn-upload-status done" title={displayName}>
          {displayName.length > 28 ? `${displayName.slice(0, 26)}...` : displayName}
        </span>
      ) : (
        <span className="fn-upload-status idle">Upload {mediaType}</span>
      )}
      {error ? <span className="fn-upload-error">{error}</span> : null}
    </div>
  );
}
