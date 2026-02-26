import { load } from "cheerio";
import pdfParse from "pdf-parse";
import { env } from "../config/env.js";
import { semanticChunkText, type SemanticChunk } from "../utils/semantic-chunk.js";
import { ingestKnowledgeChunks, type IngestChunkInput } from "./rag-service.js";

type IngestStage =
  | "Extracting text"
  | "Cleaning text"
  | "Creating AI chunks"
  | "Generating embeddings"
  | "Completed";

interface IngestProgress {
  stage: IngestStage;
  progress: number;
}

interface PdfLayoutBlock {
  page: number;
  text: string;
}

interface PdfExtractResult {
  text: string;
  pages: number;
  pageTexts: string[];
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyTextLimit(value: string): string {
  return env.INGEST_MAX_SOURCE_CHARS > 0 ? value.slice(0, env.INGEST_MAX_SOURCE_CHARS) : value;
}

function isChunkLimitReached(current: number, maxChunks: number): boolean {
  return maxChunks > 0 && current >= maxChunks;
}

function toChunkInput(chunks: SemanticChunk[], metadata: Record<string, unknown>): IngestChunkInput[] {
  return chunks.map((chunk) => ({
    content: chunk.text,
    metadata: {
      ...metadata,
      startChar: chunk.start,
      endChar: chunk.end
    }
  }));
}

function prepareManualOrWebsiteChunks(text: string, metadata: Record<string, unknown>): IngestChunkInput[] {
  const cleaned = applyTextLimit(normalizeText(text));
  const semantic = semanticChunkText(cleaned, {
    targetTokens: env.INGEST_CHUNK_TARGET_TOKENS,
    overlapTokens: env.INGEST_CHUNK_OVERLAP_TOKENS,
    maxChunks: env.INGEST_MAX_CHUNKS_PER_FILE
  });
  return toChunkInput(semantic, metadata);
}

function resolveWebsiteUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch {
    return new URL(`https://${rawUrl}`);
  }
}

async function fetchWebsitePage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "WAgenBot/1.0 (+knowledge-ingestion)"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch website page (${response.status})`);
  }

  return response.text();
}

function absoluteSameHostUrl(href: string, base: URL): string | null {
  try {
    const resolved = new URL(href, base);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }
    if (resolved.host !== base.host) {
      return null;
    }
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

function extractWebsiteTextAndImportantLinks(html: string, pageUrl: URL): { title: string; text: string; links: string[] } {
  const $ = load(html);

  $("script, style, noscript, svg, canvas, iframe").remove();
  const title = normalizeText($("title").first().text()) || pageUrl.host;
  const metaDescription = normalizeText($("meta[name='description']").attr("content") || "");

  const telOrMailtoLines: string[] = [];
  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") || "").trim();
    const label = normalizeText($(element).text());
    if (!href) {
      return;
    }
    if (href.startsWith("tel:") || href.startsWith("mailto:")) {
      const cleaned = `${label || "Contact"} ${href}`.trim();
      if (cleaned) {
        telOrMailtoLines.push(cleaned);
      }
    }
  });

  const bodyText = normalizeText($("body").text());
  const textParts = [title, metaDescription, ...telOrMailtoLines, bodyText].filter(Boolean);
  const merged = normalizeText(textParts.join("\n"));

  const candidateLinks = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") || "").trim();
    const label = normalizeText($(element).text()).toLowerCase();
    if (!href) {
      return;
    }

    const absolute = absoluteSameHostUrl(href, pageUrl);
    if (!absolute) {
      return;
    }

    if (
      /contact|about|support|help|faq|policy|terms|service|location|reach/i.test(absolute) ||
      /contact|about|support|help|faq|policy|terms|service|location|reach/i.test(label)
    ) {
      candidateLinks.add(absolute);
    }
  });

  return {
    title,
    text: merged,
    links: Array.from(candidateLinks).slice(0, 4)
  };
}

function tokenizeApprox(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

function tokenChunkText(text: string, maxTokens = 700, overlap = 100): string[] {
  const tokens = tokenizeApprox(text);
  if (tokens.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  const stride = Math.max(1, maxTokens - overlap);
  let cursor = 0;
  while (cursor < tokens.length) {
    const end = Math.min(tokens.length, cursor + maxTokens);
    const chunk = tokens.slice(cursor, end).join(" ").trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= tokens.length) {
      break;
    }
    cursor += stride;
  }
  return chunks;
}

function resolvePdfChunkConfig(text: string): { targetTokens: number; overlapTokens: number } {
  const words = tokenizeApprox(text).length;
  if (words <= 4000) {
    return { targetTokens: 280, overlapTokens: 50 };
  }
  if (words <= 9000) {
    return { targetTokens: 360, overlapTokens: 70 };
  }
  return { targetTokens: 460, overlapTokens: 80 };
}

function normalizeForDedup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeTextVariants(variants: string[]): string {
  const mergedLines: string[] = [];
  const seen = new Set<string>();

  for (const variant of variants) {
    const lines = normalizeText(variant)
      .split(/\n+/g)
      .map((line) => normalizeText(line))
      .filter(Boolean);

    for (const line of lines) {
      const key = normalizeForDedup(line);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      mergedLines.push(line);
    }
  }

  return normalizeText(mergedLines.join("\n"));
}

function removeRepeatedBlocks(blocks: PdfLayoutBlock[], threshold = 0.6): PdfLayoutBlock[] {
  if (blocks.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();
  let totalPages = 0;
  for (const block of blocks) {
    totalPages = Math.max(totalPages, block.page);
    const normalized = block.text.toLowerCase();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  if (totalPages <= 1) {
    return blocks;
  }

  return blocks.filter((block) => {
    const count = counts.get(block.text.toLowerCase()) ?? 0;
    const ratio = count / totalPages;
    return ratio < threshold;
  });
}

function mergeBlocksByPage(blocks: PdfLayoutBlock[]): Array<{ page: number; text: string }> {
  const perPage = new Map<number, string[]>();
  for (const block of blocks) {
    if (!perPage.has(block.page)) {
      perPage.set(block.page, []);
    }
    perPage.get(block.page)?.push(block.text);
  }

  return [...perPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, pageBlocks]) => ({
      page,
      text: normalizeText(pageBlocks.join("\n\n"))
    }))
    .filter((entry) => entry.text.length > 0);
}

async function extractLayoutBlocks(fileBuffer: Buffer): Promise<PdfLayoutBlock[]> {
  const blocks: PdfLayoutBlock[] = [];
  let pageNumber = 0;

  await withTimeout(
    pdfParse(fileBuffer, {
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent({ normalizeWhitespace: true });
        type Token = { str?: string; transform?: number[] };
        const items = content.items as Token[];

        const lines = new Map<number, string[]>();
        for (const item of items) {
          const text = item.str?.trim();
          if (!text) {
            continue;
          }
          const y = item.transform?.[5] ?? 0;
          const lineKey = Math.round(y * 2) / 2;
          if (!lines.has(lineKey)) {
            lines.set(lineKey, []);
          }
          lines.get(lineKey)?.push(text);
        }

        pageNumber += 1;
        const sortedLines = [...lines.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, texts]) => normalizeText(texts.join(" ")))
          .filter(Boolean);

        let buffer: string[] = [];
        for (let index = 0; index < sortedLines.length; index += 1) {
          const line = sortedLines[index];
          if (!line) {
            continue;
          }
          buffer.push(line);

          const next = sortedLines[index + 1];
          const endBlock =
            !next ||
            line.endsWith(".") ||
            line.endsWith(":") ||
            (line.length < 70 && next.length > 110) ||
            buffer.length >= 6;

          if (endBlock) {
            const text = normalizeText(buffer.join(" "));
            if (text) {
              blocks.push({ page: pageNumber, text });
            }
            buffer = [];
          }
        }

        if (buffer.length > 0) {
          const text = normalizeText(buffer.join(" "));
          if (text) {
            blocks.push({ page: pageNumber, text });
          }
        }

        return sortedLines.join("\n");
      }
    }),
    env.PDF_PARSE_TIMEOUT_MS,
    `PDF parsing timed out after ${Math.floor(env.PDF_PARSE_TIMEOUT_MS / 1000)}s`
  );

  return blocks;
}

async function extractPlainPdfText(fileBuffer: Buffer): Promise<string> {
  const parsed = await withTimeout(
    pdfParse(fileBuffer),
    env.PDF_PARSE_TIMEOUT_MS,
    `PDF parsing timed out after ${Math.floor(env.PDF_PARSE_TIMEOUT_MS / 1000)}s`
  );

  return normalizeText(parsed.text || "");
}

async function extractPageOrderedPdfText(fileBuffer: Buffer): Promise<PdfExtractResult> {
  let pages = 0;
  const pageTexts: string[] = [];

  const parsed = await withTimeout(
    pdfParse(fileBuffer, {
      pagerender: async (pageData) => {
        pages += 1;
        const content = await pageData.getTextContent({ normalizeWhitespace: true });
        type Token = { str?: string; transform?: number[] };
        const items = content.items as Token[];

        const lines = new Map<number, Array<{ x: number; text: string }>>();
        for (const item of items) {
          const text = item.str?.trim();
          if (!text) {
            continue;
          }

          const y = item.transform?.[5] ?? 0;
          const x = item.transform?.[4] ?? 0;
          const lineKey = Math.round(y * 2) / 2;
          if (!lines.has(lineKey)) {
            lines.set(lineKey, []);
          }
          lines.get(lineKey)?.push({ x, text });
        }

        const sortedLines = [...lines.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, entries]) =>
            entries
              .sort((a, b) => a.x - b.x)
              .map((entry) => entry.text)
              .join(" ")
          )
          .map((line) => normalizeText(line))
          .filter(Boolean);

        const pageText = normalizeText(sortedLines.join("\n"));
        pageTexts.push(pageText);
        return pageText;
      }
    }),
    env.PDF_PARSE_TIMEOUT_MS,
    `PDF parsing timed out after ${Math.floor(env.PDF_PARSE_TIMEOUT_MS / 1000)}s`
  );

  const text = normalizeText(parsed.text || "");
  return { text, pages, pageTexts };
}

function buildPdfChunksFromText(
  text: string,
  metadata: Record<string, unknown>,
  maxChunks = env.INGEST_MAX_CHUNKS_PER_FILE
): IngestChunkInput[] {
  const cleaned = applyTextLimit(normalizeText(text));
  if (!cleaned) {
    return [];
  }

  const config = resolvePdfChunkConfig(cleaned);
  const tokenChunks = tokenChunkText(cleaned, config.targetTokens, config.overlapTokens);
  return tokenChunks.slice(0, maxChunks).map((content, index) => ({
    content,
    metadata: {
      ...metadata,
      segment: index + 1,
      chunkStrategy: "pdf_token",
      targetTokens: config.targetTokens,
      overlapTokens: config.overlapTokens
    }
  }));
}

function buildPdfChunksFromPages(
  fileName: string,
  pageTexts: string[],
  maxChunks = env.INGEST_MAX_CHUNKS_PER_FILE
): IngestChunkInput[] {
  const chunks: IngestChunkInput[] = [];

  for (let pageIndex = 0; pageIndex < pageTexts.length; pageIndex += 1) {
    const pageText = normalizeText(pageTexts[pageIndex] || "");
    if (!pageText) {
      continue;
    }

    const config = resolvePdfChunkConfig(pageText);
    const pageChunks = tokenChunkText(pageText, config.targetTokens, config.overlapTokens);
    for (let i = 0; i < pageChunks.length; i += 1) {
      const content = pageChunks[i]?.trim();
      if (!content) {
        continue;
      }

      chunks.push({
        content,
        metadata: {
          source: fileName,
          page: pageIndex + 1,
          segment: i + 1,
          chunkStrategy: "pdf_page_token",
          targetTokens: config.targetTokens,
          overlapTokens: config.overlapTokens
        }
      });

      if (isChunkLimitReached(chunks.length, maxChunks)) {
        return chunks;
      }
    }
  }

  return chunks;
}

function dedupeChunks(chunks: IngestChunkInput[]): IngestChunkInput[] {
  const deduped: IngestChunkInput[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const normalized = normalizeForDedup(chunk.content);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(chunk);
  }

  return deduped;
}

function buildPdfChunks(fileName: string, blocks: PdfLayoutBlock[]): IngestChunkInput[] {
  const cleanedBlocks = removeRepeatedBlocks(blocks);
  const paragraphs = mergeBlocksByPage(cleanedBlocks);
  const chunks: IngestChunkInput[] = [];

  for (const paragraph of paragraphs) {
    const config = resolvePdfChunkConfig(paragraph.text);
    const tokenChunks = tokenChunkText(
      paragraph.text,
      config.targetTokens,
      config.overlapTokens
    );

    for (let i = 0; i < tokenChunks.length; i += 1) {
      const content = tokenChunks[i]?.trim();
      if (!content) {
        continue;
      }
      chunks.push({
        content,
        metadata: {
          source: fileName,
          page: paragraph.page,
          segment: i + 1,
          chunkStrategy: "pdf_layout_token",
          targetTokens: config.targetTokens,
          overlapTokens: config.overlapTokens
        }
      });
      if (isChunkLimitReached(chunks.length, env.INGEST_MAX_CHUNKS_PER_FILE)) {
        return chunks;
      }
    }
  }

  return chunks;
}

export async function ingestManualText(userId: string, text: string, sourceName?: string): Promise<number> {
  const resolvedSource = (sourceName || "").trim() || `Manual-${new Date().toISOString()}`;
  const chunks = prepareManualOrWebsiteChunks(text, { source: resolvedSource });
  return ingestKnowledgeChunks({
    userId,
    sourceType: "manual",
    sourceName: resolvedSource,
    chunks
  });
}

export async function ingestWebsiteUrl(userId: string, url: string, sourceName?: string): Promise<number> {
  const rootUrl = resolveWebsiteUrl(url);
  const rootHtml = await fetchWebsitePage(rootUrl.toString());
  const rootExtracted = extractWebsiteTextAndImportantLinks(rootHtml, rootUrl);

  const pagePayloads: Array<{ pageUrl: string; title: string; text: string }> = [
    { pageUrl: rootUrl.toString(), title: rootExtracted.title, text: rootExtracted.text }
  ];

  for (const linkedUrl of rootExtracted.links) {
    try {
      const html = await fetchWebsitePage(linkedUrl);
      const extracted = extractWebsiteTextAndImportantLinks(html, new URL(linkedUrl));
      pagePayloads.push({
        pageUrl: linkedUrl,
        title: extracted.title,
        text: extracted.text
      });
    } catch {
      // Best-effort page crawl; keep ingesting with available pages.
    }
  }

  const chunks: IngestChunkInput[] = [];
  for (const payload of pagePayloads) {
    const pageChunks = prepareManualOrWebsiteChunks(payload.text, {
      source: payload.title || rootUrl.host,
      url: payload.pageUrl,
      sourceKind: "website_page"
    });
    chunks.push(...pageChunks);
  }

  if (chunks.length === 0) {
    throw new Error("No readable text found on website. Try adding manual FAQ or a different page URL.");
  }

  const resolvedSourceName = sourceName?.trim() || rootExtracted.title || rootUrl.host;
  return ingestKnowledgeChunks({
    userId,
    sourceType: "website",
    sourceName: resolvedSourceName,
    chunks
  });
}

export async function ingestPdfBuffer(
  userId: string,
  fileName: string,
  fileBuffer: Buffer,
  options?: { onProgress?: (state: IngestProgress) => void }
): Promise<number> {
  options?.onProgress?.({ stage: "Extracting text", progress: 20 });
  const plainText = await extractPlainPdfText(fileBuffer);
  const pageOrdered = await extractPageOrderedPdfText(fileBuffer);

  const mergedText = mergeTextVariants([pageOrdered.text, plainText]);
  const candidates = [mergedText, plainText, pageOrdered.text].map((value) => normalizeText(value)).filter(Boolean);
  const bestText = candidates.sort((a, b) => b.length - a.length)[0] ?? "";

  const minimumExpectedChars =
    pageOrdered.pages > 0 ? Math.max(env.PDF_MIN_TEXT_CHARS, pageOrdered.pages * 500) : env.PDF_MIN_TEXT_CHARS;
  let chunks: IngestChunkInput[] = [];

  if (bestText.length >= minimumExpectedChars) {
    const pageChunks = buildPdfChunksFromPages(fileName, pageOrdered.pageTexts);
    const supplementalChunks = buildPdfChunksFromText(bestText, {
      source: fileName,
      extraction: "merged_pdf_text"
    });
    const merged = dedupeChunks([...pageChunks, ...supplementalChunks]);
    chunks =
      env.INGEST_MAX_CHUNKS_PER_FILE > 0
        ? merged.slice(0, env.INGEST_MAX_CHUNKS_PER_FILE)
        : merged;
  } else {
    const blocks = await extractLayoutBlocks(fileBuffer);
    if (blocks.length === 0) {
      throw new Error("No readable text found in PDF");
    }
    chunks = buildPdfChunks(fileName, blocks);
  }

  options?.onProgress?.({ stage: "Cleaning text", progress: 38 });
  if (chunks.length === 0) {
    throw new Error("No chunkable text found in PDF");
  }

  options?.onProgress?.({ stage: "Creating AI chunks", progress: 52 });
  const created = await ingestKnowledgeChunks({
    userId,
    sourceType: "pdf",
    sourceName: fileName,
    chunks,
    onEmbeddingProgress: (completed, total) => {
      const ratio = total > 0 ? completed / total : 1;
      const progress = 60 + ratio * 38;
      options?.onProgress?.({ stage: "Generating embeddings", progress: clampProgress(progress) });
    }
  });

  return created;
}
