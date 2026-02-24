import { load } from "cheerio";
import pdfParse from "pdf-parse";
import { chunkText } from "../utils/chunk-text.js";
import { ingestKnowledgeChunks } from "./rag-service.js";

function trimToReasonableSize(value: string): string {
  return value.slice(0, 180_000);
}

export async function ingestManualText(userId: string, text: string): Promise<number> {
  const prepared = trimToReasonableSize(text);
  const chunks = chunkText(prepared);
  return ingestKnowledgeChunks({
    userId,
    sourceType: "manual",
    sourceName: "Manual FAQ",
    chunks
  });
}

export async function ingestWebsiteUrl(userId: string, url: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);
  $("script, style, noscript").remove();

  const title = $("title").text().trim() || url;
  const text = trimToReasonableSize($("body").text());
  const chunks = chunkText(text);

  return ingestKnowledgeChunks({
    userId,
    sourceType: "website",
    sourceName: title,
    chunks
  });
}

export async function ingestPdfBuffer(userId: string, fileName: string, fileBuffer: Buffer): Promise<number> {
  const parsed = await pdfParse(fileBuffer);
  const text = trimToReasonableSize(parsed.text);
  const chunks = chunkText(text);

  return ingestKnowledgeChunks({
    userId,
    sourceType: "pdf",
    sourceName: fileName,
    chunks
  });
}