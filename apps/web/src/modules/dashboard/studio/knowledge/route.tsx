import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import {
  fetchSourceChunks,
  fetchUploadJobs,
  ingestManualSource,
  ingestWebsiteSource,
  persistKnowledgeBasics,
  removeSource,
  uploadKnowledgeFiles,
  type BusinessBasicsPayload,
  type KnowledgeChunkPreview,
  type KnowledgeSource
} from "./api";
import { buildKnowledgeSourcesQueryOptions, useKnowledgeSourcesQuery } from "./queries";

const MAX_KNOWLEDGE_FILE_UPLOAD_BYTES = 20 * 1024 * 1024;
const SUPPORTED_KNOWLEDGE_FILE_EXTENSIONS = new Set(["pdf", "txt", "doc", "docx", "xls", "xlsx"]);

type KnowledgeModalMode = "add" | "edit";
type KnowledgeModalType = "manual" | "website" | "file";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  progress: number;
  jobId?: string;
  chunks?: number;
  error?: string;
};

const DEFAULT_BUSINESS_BASICS: BusinessBasicsPayload = {
  companyName: "",
  whatDoYouSell: "",
  targetAudience: "",
  usp: "",
  objections: "",
  defaultCountry: "IN",
  defaultCurrency: "INR",
  greetingScript: "",
  availabilityScript: "",
  objectionHandlingScript: "",
  bookingScript: "",
  feedbackCollectionScript: "",
  complaintHandlingScript: "",
  supportEmail: "",
  aiDoRules: "",
  aiDontRules: "",
  escalationWhenToEscalate: "",
  escalationContactPerson: "",
  escalationPhoneNumber: "",
  escalationEmail: ""
};

function loadBusinessBasics(value: unknown): BusinessBasicsPayload {
  if (!value || typeof value !== "object") {
    return DEFAULT_BUSINESS_BASICS;
  }
  return {
    ...DEFAULT_BUSINESS_BASICS,
    ...(value as Partial<BusinessBasicsPayload>)
  };
}

function isSupportedKnowledgeFile(file: File): boolean {
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
  return Boolean(extension && SUPPORTED_KNOWLEDGE_FILE_EXTENSIONS.has(extension));
}

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readMetaString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function readMetaNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sortChunksForEditing(chunks: KnowledgeChunkPreview[]): KnowledgeChunkPreview[] {
  return [...chunks].sort((left, right) => {
    const leftMeta = getNestedRecord(left.metadata_json);
    const rightMeta = getNestedRecord(right.metadata_json);
    const leftStart = readMetaNumber(leftMeta, "startChar");
    const rightStart = readMetaNumber(rightMeta, "startChar");
    if (leftStart !== null || rightStart !== null) {
      if (leftStart === null) return 1;
      if (rightStart === null) return -1;
      if (leftStart !== rightStart) return leftStart - rightStart;
    }

    const leftPage = readMetaNumber(leftMeta, "page");
    const rightPage = readMetaNumber(rightMeta, "page");
    if (leftPage !== null || rightPage !== null) {
      if (leftPage === null) return 1;
      if (rightPage === null) return -1;
      if (leftPage !== rightPage) return leftPage - rightPage;
      const leftSegment = readMetaNumber(leftMeta, "segment") ?? 0;
      const rightSegment = readMetaNumber(rightMeta, "segment") ?? 0;
      if (leftSegment !== rightSegment) {
        return leftSegment - rightSegment;
      }
    }

    const leftCreatedAt = Date.parse(left.created_at);
    const rightCreatedAt = Date.parse(right.created_at);
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return left.id.localeCompare(right.id);
  });
}

function rebuildManualSourceText(chunks: KnowledgeChunkPreview[]): string {
  const unique = new Set<string>();
  const sections: string[] = [];
  for (const chunk of sortChunksForEditing(chunks)) {
    const text = chunk.content_chunk.trim();
    if (!text) {
      continue;
    }
    const key = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || unique.has(key)) {
      continue;
    }
    unique.add(key);
    sections.push(text);
  }
  return sections.join("\n\n").trim();
}

function resolveWebsiteSourceUrl(chunks: KnowledgeChunkPreview[]): string {
  const urls = new Set<string>();
  for (const chunk of sortChunksForEditing(chunks)) {
    const url = readMetaString(getNestedRecord(chunk.metadata_json), "url");
    if (url) {
      urls.add(url);
    }
  }
  if (urls.size === 0) {
    return "";
  }
  return Array.from(urls).sort((left, right) => left.length - right.length)[0] ?? "";
}

export function Component() {
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  const { token } = useDashboardShell();
  const knowledgeSourcesQuery = useKnowledgeSourcesQuery(token);
  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knowledgeModalRequestRef = useRef(0);
  const [showKnowledgeMenu, setShowKnowledgeMenu] = useState(false);
  const [knowledgeModal, setKnowledgeModal] = useState<KnowledgeModalType | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeModalMode>("add");
  const [editingSource, setEditingSource] = useState<{ sourceType: KnowledgeSource["source_type"]; sourceName: string } | null>(null);
  const [modalSourceName, setModalSourceName] = useState("");
  const [modalWebsiteUrl, setModalWebsiteUrl] = useState("");
  const [modalManualText, setModalManualText] = useState("");
  const [modalKnowledgeFiles, setModalKnowledgeFiles] = useState<File[]>([]);
  const [knowledgeModalLoading, setKnowledgeModalLoading] = useState(false);
  const [chunkViewerSource, setChunkViewerSource] = useState<{ sourceType: KnowledgeSource["source_type"]; sourceName: string } | null>(null);
  const [chunkViewerItems, setChunkViewerItems] = useState<KnowledgeChunkPreview[]>([]);
  const [chunkViewerLoading, setChunkViewerLoading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pdfUploadItems, setPdfUploadItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const basics = loadBusinessBasics(user?.business_basics);
  const websiteUrl = typeof user?.business_basics?.websiteUrl === "string" ? user.business_basics.websiteUrl : "";
  const manualFaq = typeof user?.business_basics?.manualFaq === "string" ? user.business_basics.manualFaq : "";

  const stopUploadPolling = () => {
    if (uploadPollRef.current) {
      clearInterval(uploadPollRef.current);
      uploadPollRef.current = null;
    }
  };

  useEffect(() => () => stopUploadPolling(), []);

  const refreshSources = async () => {
    await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.knowledgeRoot });
  };

  const persistBusinessKnowledge = async (nextWebsite: string, nextManual: string) => {
    await persistKnowledgeBasics(token, {
      ...basics,
      websiteUrl: nextWebsite.trim(),
      manualFaq: nextManual.trim()
    });
    await refreshUser();
  };

  const handleIngest = async (source: "website" | "manual", rawValue: string, sourceName?: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      let nextWebsite = websiteUrl.trim();
      let nextManual = manualFaq.trim();

      if (source === "website") {
        const url = rawValue.trim();
        if (!url) {
          throw new Error("Enter a website URL first.");
        }
        const response = await ingestWebsiteSource(token, url, sourceName);
        setInfo(`URL ingested (${response.chunks} chunks).`);
        nextWebsite = url;
      } else {
        const text = rawValue.trim();
        if (text.length < 20) {
          throw new Error("Manual text must be at least 20 characters.");
        }
        const response = await ingestManualSource(token, text, sourceName);
        setInfo(`Text ingested (${response.chunks} chunks).`);
        nextManual = text;
      }

      await persistBusinessKnowledge(nextWebsite, nextManual);
      await refreshSources();
    } catch (ingestError) {
      setError((ingestError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleKnowledgeFileUpload = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    if (uploadingFiles) {
      setError("A file upload is already running.");
      return;
    }

    const accepted = files.filter((file) => isSupportedKnowledgeFile(file) && file.size <= MAX_KNOWLEDGE_FILE_UPLOAD_BYTES);
    if (accepted.length === 0) {
      setError("No valid file selected. Supported: PDF, TXT, DOC, DOCX, XLS, XLSX (max 20MB each).");
      return;
    }

    const uploadItems = accepted.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`,
      name: file.name,
      size: file.size,
      status: "uploading" as const,
      progress: 0
    }));
    setPdfUploadItems((current) => [...uploadItems, ...current].slice(0, 25));
    setUploadingFiles(true);
    setError(null);
    setInfo(null);
    stopUploadPolling();

    try {
      const response = await uploadKnowledgeFiles(token, accepted);
      const jobsByName = new Map(response.jobs.map((job) => [job.source_name || "", job]));
      setPdfUploadItems((current) =>
        current.map((item) => {
          const job = jobsByName.get(item.name);
          if (!job) {
            return { ...item, status: "error", progress: 100, error: "Job not created" };
          }
          return { ...item, jobId: job.id, status: "uploading", progress: Math.max(5, job.progress || 0) };
        })
      );

      const jobIds = response.jobs.map((job) => job.id);
      uploadPollRef.current = setInterval(() => {
        void fetchUploadJobs(token, jobIds)
          .then((jobsResponse) => {
            setPdfUploadItems((current) =>
              current.map((item) => {
                const job = jobsResponse.jobs.find((candidate) => candidate.id === item.jobId);
                if (!job) {
                  return item;
                }
                if (job.status === "failed") {
                  return { ...item, status: "error", progress: 100, error: job.error_message || "Upload failed" };
                }
                const done = job.status === "completed" || Boolean(job.completed_at) || job.progress >= 100;
                if (done) {
                  return { ...item, status: "done", progress: 100, chunks: job.chunks_created };
                }
                return { ...item, status: "uploading", progress: job.progress };
              })
            );

            const pending = jobsResponse.jobs.some((job) => job.status === "queued" || job.status === "processing");
            if (!pending) {
              stopUploadPolling();
              setUploadingFiles(false);
              void refreshSources();
            }
          })
          .catch(() => {
            stopUploadPolling();
            setUploadingFiles(false);
          });
      }, 1500);
    } catch (uploadError) {
      setUploadingFiles(false);
      setPdfUploadItems((current) =>
        current.map((item) => ({
          ...item,
          status: "error",
          progress: 100,
          error: (uploadError as Error).message
        }))
      );
    }
  };

  const handleDeleteSource = async (sourceType: KnowledgeSource["source_type"], sourceName: string | null) => {
    if (!sourceName) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await removeSource(token, { sourceType, sourceName });
      await refreshSources();
      setInfo("Source deleted.");
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openKnowledgeModal = async (
    type: KnowledgeModalType,
    mode: KnowledgeModalMode = "add",
    source?: { sourceType: KnowledgeSource["source_type"]; sourceName: string }
  ) => {
    knowledgeModalRequestRef.current += 1;
    const requestId = knowledgeModalRequestRef.current;
    setShowKnowledgeMenu(false);
    setKnowledgeMode(mode);
    setEditingSource(source ?? null);
    setKnowledgeModal(type);
    setKnowledgeModalLoading(false);
    setModalSourceName(source?.sourceName ?? "");
    if (type === "website") {
      setModalWebsiteUrl(mode === "edit" ? "" : websiteUrl);
    }
    if (type === "manual") {
      setModalManualText(mode === "edit" ? "" : manualFaq);
    }
    if (type === "file") {
      setModalKnowledgeFiles([]);
    }

    if (mode !== "edit" || !source || type === "file") {
      return;
    }

    setKnowledgeModalLoading(true);
    setError(null);
    try {
      const response = await fetchSourceChunks(token, {
        sourceType: source.sourceType,
        sourceName: source.sourceName,
        limit: 200
      });
      if (knowledgeModalRequestRef.current !== requestId) {
        return;
      }
      if (type === "manual") {
        setModalManualText(rebuildManualSourceText(response.chunks));
      } else {
        const detectedUrl = resolveWebsiteSourceUrl(response.chunks);
        setModalWebsiteUrl(detectedUrl || websiteUrl);
      }
    } catch (modalError) {
      if (knowledgeModalRequestRef.current === requestId) {
        setError((modalError as Error).message);
      }
    } finally {
      if (knowledgeModalRequestRef.current === requestId) {
        setKnowledgeModalLoading(false);
      }
    }
  };

  const closeKnowledgeModal = () => {
    knowledgeModalRequestRef.current += 1;
    setKnowledgeModalLoading(false);
    setKnowledgeModal(null);
    setEditingSource(null);
    setKnowledgeMode("add");
  };

  const handleProceedKnowledgeModal = async () => {
    if (!knowledgeModal) {
      return;
    }

    const resolvedSourceName = modalSourceName.trim() || editingSource?.sourceName || undefined;
    if (knowledgeMode === "edit" && editingSource?.sourceName) {
      await handleDeleteSource(editingSource.sourceType, editingSource.sourceName);
    }

    if (knowledgeModal === "website") {
      await handleIngest("website", modalWebsiteUrl, resolvedSourceName);
      closeKnowledgeModal();
      return;
    }

    if (knowledgeModal === "manual") {
      await handleIngest("manual", modalManualText, resolvedSourceName);
      closeKnowledgeModal();
      return;
    }

    await handleKnowledgeFileUpload(modalKnowledgeFiles);
    closeKnowledgeModal();
  };

  const openChunkViewer = async (sourceType: KnowledgeSource["source_type"], sourceName: string | null) => {
    if (!sourceName) {
      return;
    }
    setChunkViewerSource({ sourceType, sourceName });
    setChunkViewerLoading(true);
    try {
      const response = await fetchSourceChunks(token, { sourceType, sourceName, limit: 120 });
      setChunkViewerItems(response.chunks);
    } catch {
      setChunkViewerItems([]);
    } finally {
      setChunkViewerLoading(false);
    }
  };

  return (
    <section className="finance-shell">
      <article className="finance-panel">
        {info ? <p className="info-text">{info}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <div className="kb-toolbar">
          <h2>Articles</h2>
          <div className="kb-toolbar-actions">
            <button className="ghost-btn" type="button" disabled={busy} onClick={() => void refreshSources()}>
              Refresh
            </button>
            <div className="kb-add-wrap">
              <button className="primary-btn" type="button" disabled={busy} onClick={() => setShowKnowledgeMenu((current) => !current)}>
                + New
              </button>
              {showKnowledgeMenu ? (
                <div className="kb-add-menu">
                  <button type="button" onClick={() => void openKnowledgeModal("manual")}>
                    <strong>Manual</strong>
                    <small>Manually add business info to train the chatbot</small>
                  </button>
                  <button type="button" onClick={() => void openKnowledgeModal("website")}>
                    <strong>URL</strong>
                    <small>Add URL and fetch pages from your website</small>
                  </button>
                  <button type="button" onClick={() => void openKnowledgeModal("file")}>
                    <strong>Document</strong>
                    <small>Upload PDF, TXT, DOC, DOCX, XLS, or XLSX files</small>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {pdfUploadItems.length > 0 ? (
          <div className="file-chip-list">
            {pdfUploadItems.map((item) => (
              <span key={item.id} className="file-chip">
                {item.name}{" "}
                {item.status === "uploading"
                  ? `Uploading (${item.progress ?? 0}%)`
                  : item.status === "done"
                    ? `Done (${item.chunks ?? 0} chunks)`
                    : `Failed: ${item.error || "upload error"}`}
              </span>
            ))}
          </div>
        ) : null}

        {(knowledgeSourcesQuery.data ?? []).length === 0 ? (
          <p className="empty-note">No articles found.</p>
        ) : (
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Title & Description</th>
                  <th>Type</th>
                  <th>Created On</th>
                  <th>Chunks</th>
                  <th>Modified On</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(knowledgeSourcesQuery.data ?? []).map((source) => (
                  <tr key={`${source.source_type}-${source.source_name}-${source.last_ingested_at}`}>
                    <td>{source.source_name || "Untitled source"}</td>
                    <td>{source.source_type}</td>
                    <td>{new Date(source.last_ingested_at).toLocaleDateString()}</td>
                    <td>{source.chunks}</td>
                    <td>{new Date(source.last_ingested_at).toLocaleString()}</td>
                    <td>Success</td>
                    <td>
                      {source.source_name ? (
                        <div className="kb-row-actions">
                          <button className="ghost-btn" type="button" onClick={() => void openChunkViewer(source.source_type, source.source_name)}>
                            View chunks
                          </button>
                          {source.source_type === "manual" || source.source_type === "website" ? (
                            <button
                              className="ghost-btn"
                              type="button"
                              onClick={() =>
                                void openKnowledgeModal(
                                  source.source_type === "manual" ? "manual" : "website",
                                  "edit",
                                  { sourceType: source.source_type, sourceName: source.source_name as string }
                                )
                              }
                            >
                              Edit
                            </button>
                          ) : null}
                          <button className="ghost-btn" type="button" disabled={busy} onClick={() => void handleDeleteSource(source.source_type, source.source_name)}>
                            Delete
                          </button>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {knowledgeModal ? (
        <div className="kb-modal-backdrop" onClick={closeKnowledgeModal}>
          <div className="kb-modal" onClick={(event) => event.stopPropagation()}>
            <h3>
              {knowledgeMode === "edit"
                ? "Edit knowledge"
                : knowledgeModal === "manual"
                  ? "Add manual text"
                  : knowledgeModal === "website"
                    ? "Add URL"
                    : "Add document"}
            </h3>
            {knowledgeMode === "edit" && knowledgeModalLoading ? <p className="tiny-note">Loading existing source content...</p> : null}

            {knowledgeModal !== "file" ? (
              <label>
                Knowledge name
                <input
                  value={modalSourceName}
                  onChange={(event) => setModalSourceName(event.target.value)}
                  disabled={knowledgeModalLoading}
                />
              </label>
            ) : null}

            {knowledgeModal === "manual" ? (
              <label>
                Manual content
                <textarea value={modalManualText} onChange={(event) => setModalManualText(event.target.value)} />
              </label>
            ) : null}

            {knowledgeModal === "website" ? (
              <label>
                Website URL
                <input type="url" value={modalWebsiteUrl} onChange={(event) => setModalWebsiteUrl(event.target.value)} />
              </label>
            ) : null}

            {knowledgeModal === "file" ? (
              <label>
                Document file(s)
                <input
                  type="file"
                  accept=".pdf,.txt,.doc,.docx,.xls,.xlsx"
                  multiple
                  onChange={(event) => setModalKnowledgeFiles(Array.from(event.target.files ?? []))}
                />
              </label>
            ) : null}

            <div className="kb-modal-actions">
              <button type="button" className="ghost-btn" onClick={closeKnowledgeModal}>
                Cancel
              </button>
              <button type="button" className="primary-btn" disabled={busy} onClick={() => void handleProceedKnowledgeModal()}>
                Proceed
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {chunkViewerSource ? (
        <div className="kb-modal-backdrop" onClick={() => setChunkViewerSource(null)}>
          <div className="kb-modal kb-modal-wide" onClick={(event) => event.stopPropagation()}>
            <h3>Chunks: {chunkViewerSource.sourceName}</h3>
            {chunkViewerLoading ? (
              <p className="tiny-note">Loading chunks...</p>
            ) : chunkViewerItems.length === 0 ? (
              <p className="empty-note">No chunks found for this source.</p>
            ) : (
              <div className="kb-chunk-list">
                {chunkViewerItems.map((chunk) => (
                  <article key={chunk.id} className="kb-chunk-card">
                    <header>
                      <strong>{chunk.source_type}</strong>
                      <small>{new Date(chunk.created_at).toLocaleString()}</small>
                    </header>
                    <p>{chunk.content_chunk}</p>
                  </article>
                ))}
              </div>
            )}
            <div className="kb-modal-actions">
              <button type="button" className="primary-btn" onClick={() => setChunkViewerSource(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildKnowledgeSourcesQueryOptions(token));
}
