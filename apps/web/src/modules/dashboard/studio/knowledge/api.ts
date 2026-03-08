import {
  deleteKnowledgeSource,
  fetchIngestionJobs,
  fetchKnowledgeChunks,
  fetchKnowledgeSources,
  ingestKnowledgeFiles,
  ingestManual,
  ingestWebsite,
  saveBusinessBasics,
  type BusinessBasicsPayload,
  type KnowledgeChunkPreview,
  type KnowledgeIngestJob,
  type KnowledgeSource
} from "../../../../lib/api";

export function fetchSources(token: string): Promise<{ sources: KnowledgeSource[] }> {
  return fetchKnowledgeSources(token);
}

export function fetchSourceChunks(
  token: string,
  options: { sourceType: KnowledgeSource["source_type"]; sourceName: string; limit: number }
) {
  return fetchKnowledgeChunks(token, options);
}

export function removeSource(
  token: string,
  payload: { sourceType: KnowledgeSource["source_type"]; sourceName: string }
) {
  return deleteKnowledgeSource(token, payload);
}

export function ingestWebsiteSource(token: string, url: string, sourceName?: string) {
  return ingestWebsite(token, url, sourceName);
}

export function ingestManualSource(token: string, text: string, sourceName?: string) {
  return ingestManual(token, text, sourceName);
}

export function uploadKnowledgeFiles(token: string, files: File[]) {
  return ingestKnowledgeFiles(token, files);
}

export function fetchUploadJobs(token: string, ids: string[]) {
  return fetchIngestionJobs(token, ids);
}

export function persistKnowledgeBasics(
  token: string,
  payload: BusinessBasicsPayload
) {
  return saveBusinessBasics(token, payload);
}

export type { BusinessBasicsPayload, KnowledgeChunkPreview, KnowledgeIngestJob, KnowledgeSource };
