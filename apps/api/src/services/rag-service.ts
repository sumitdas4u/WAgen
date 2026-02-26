import { pool, withTransaction } from "../db/pool.js";
import { openAIService } from "./openai-service.js";
import { toVectorLiteral } from "../utils/index.js";

export interface KnowledgeChunk {
  id: string;
  content_chunk: string;
  source_type: string;
  source_name: string | null;
  similarity: number;
}

export interface KnowledgeSource {
  source_type: string;
  source_name: string | null;
  chunks: number;
  last_ingested_at: string;
}

export interface KnowledgeChunkPreview {
  id: string;
  content_chunk: string;
  source_type: string;
  source_name: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

const ZERO_VECTOR = toVectorLiteral(Array.from({ length: 1536 }, () => 0));

export interface IngestChunkInput {
  content: string;
  metadata?: Record<string, unknown>;
}

function extractLexicalTerms(query: string): string[] {
  const STOP = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "have",
    "has",
    "from",
    "you",
    "your",
    "what",
    "when",
    "where",
    "which",
    "how",
    "why",
    "can",
    "are",
    "was",
    "were",
    "will",
    "shall",
    "about",
    "please",
    "want",
    "need"
  ]);

  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !STOP.has(term))
    )
  );
}

function mergeAndLimitChunks(primary: KnowledgeChunk[], secondary: KnowledgeChunk[], limit: number): KnowledgeChunk[] {
  const seen = new Set<string>();
  const merged: KnowledgeChunk[] = [];

  for (const row of [...primary, ...secondary]) {
    if (!row?.id || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    merged.push(row);
    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

export async function ingestKnowledgeChunks(input: {
  userId: string;
  sourceType: "pdf" | "website" | "manual";
  sourceName?: string;
  chunks: Array<string | IngestChunkInput>;
  onEmbeddingProgress?: (completed: number, total: number) => void;
}): Promise<number> {
  const validChunks = input.chunks
    .map((chunk) => {
      if (typeof chunk === "string") {
        return { content: chunk.trim(), metadata: {} as Record<string, unknown> };
      }
      return { content: chunk.content.trim(), metadata: chunk.metadata ?? {} };
    })
    .filter((chunk) => Boolean(chunk.content));

  if (validChunks.length === 0) {
    return 0;
  }

  if (!openAIService.isConfigured()) {
    throw new Error("OPENAI_API_KEY is missing. Cannot ingest knowledge without embeddings.");
  }

  await withTransaction(async (client) => {
    let completed = 0;
    for (const chunk of validChunks) {
      let vectorLiteral = ZERO_VECTOR;
      try {
        const embedding = await openAIService.embed(chunk.content);
        vectorLiteral = toVectorLiteral(embedding);
      } catch {
        vectorLiteral = ZERO_VECTOR;
      }

      await client.query(
        `INSERT INTO knowledge_base (user_id, source_type, source_name, content_chunk, embedding_vector, metadata_json)
         VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)`,
        [input.userId, input.sourceType, input.sourceName ?? null, chunk.content, vectorLiteral, JSON.stringify(chunk.metadata)]
      );

      completed += 1;
      input.onEmbeddingProgress?.(completed, validChunks.length);
    }
  });

  return validChunks.length;
}

export async function retrieveKnowledge(input: {
  userId: string;
  query: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<KnowledgeChunk[]> {
  const limit = input.limit ?? 5;
  const minSimilarity = Math.max(0, Math.min(1, input.minSimilarity ?? 0));

  if (!openAIService.isConfigured()) {
    return [];
  }

  const lexicalTerms = extractLexicalTerms(input.query);
  const tsQuery =
    lexicalTerms.length > 0
      ? lexicalTerms.map((term) => `${term}:*`).join(" | ")
      : null;

  const runLexicalQuery = async (): Promise<KnowledgeChunk[]> => {
    if (!tsQuery) {
      return [];
    }

    const lexical = await pool.query<KnowledgeChunk>(
      `SELECT
         id,
         content_chunk,
         source_type,
         source_name,
         ts_rank(to_tsvector('simple', content_chunk), to_tsquery('simple', $2)) AS similarity
       FROM knowledge_base
       WHERE user_id = $1
         AND to_tsvector('simple', content_chunk) @@ to_tsquery('simple', $2)
       ORDER BY similarity DESC, created_at DESC
       LIMIT $3`,
      [input.userId, tsQuery, limit]
    );

    return lexical.rows;
  };

  try {
    const embedding = await openAIService.embed(input.query);
    const vectorLiteral = toVectorLiteral(embedding);

    const vectorResult = await pool.query<KnowledgeChunk>(
      `SELECT
        id,
        content_chunk,
        source_type,
        source_name,
        1 - (embedding_vector <=> $2::vector) AS similarity
       FROM knowledge_base
       WHERE user_id = $1
         AND 1 - (embedding_vector <=> $2::vector) >= $4
       ORDER BY embedding_vector <=> $2::vector
       LIMIT $3`,
      [input.userId, vectorLiteral, limit, minSimilarity]
    );

    const lexicalRows = await runLexicalQuery();
    const merged =
      lexicalRows.length > 0
        ? mergeAndLimitChunks(lexicalRows, vectorResult.rows, limit)
        : mergeAndLimitChunks(vectorResult.rows, lexicalRows, limit);
    if (merged.length > 0) {
      return merged;
    }

    // Final lexical fallback (broad) if both vector and strict lexical return empty.
    const broadFallback = await pool.query<KnowledgeChunk>(
      `SELECT
         id,
         content_chunk,
         source_type,
         source_name,
         ts_rank(to_tsvector('simple', content_chunk), plainto_tsquery('simple', $2)) AS similarity
       FROM knowledge_base
       WHERE user_id = $1
       ORDER BY similarity DESC, created_at DESC
       LIMIT $3`,
      [input.userId, input.query, limit]
    );
    return broadFallback.rows;
  } catch {
    if (tsQuery) {
      const lexicalRows = await runLexicalQuery();
      if (lexicalRows.length > 0) {
        return lexicalRows;
      }
    }

    const lexicalResult = await pool.query<KnowledgeChunk>(
      `SELECT
        id,
        content_chunk,
        source_type,
        source_name,
        ts_rank(to_tsvector('simple', content_chunk), plainto_tsquery('simple', $2)) AS similarity
       FROM knowledge_base
       WHERE user_id = $1
       ORDER BY similarity DESC, created_at DESC
       LIMIT $3`,
      [input.userId, input.query, limit]
    );
    return lexicalResult.rows;
  }
}

export async function getKnowledgeStats(userId: string): Promise<{ chunks: number }> {
  const result = await pool.query<{ chunks: string }>(
    `SELECT COUNT(*)::text AS chunks
     FROM knowledge_base
     WHERE user_id = $1`,
    [userId]
  );

  return { chunks: Number(result.rows[0]?.chunks ?? 0) };
}

export async function listKnowledgeSources(
  userId: string,
  sourceType?: "pdf" | "website" | "manual"
): Promise<KnowledgeSource[]> {
  const result = await pool.query<{
    source_type: string;
    source_name: string | null;
    chunks: string;
    last_ingested_at: string;
  }>(
    `SELECT
       source_type,
       source_name,
       COUNT(*)::text AS chunks,
       MAX(created_at) AS last_ingested_at
     FROM knowledge_base
     WHERE user_id = $1
       AND ($2::text IS NULL OR source_type = $2)
     GROUP BY source_type, source_name
     ORDER BY MAX(created_at) DESC`,
    [userId, sourceType ?? null]
  );

  return result.rows.map((row) => ({
    source_type: row.source_type,
    source_name: row.source_name,
    chunks: Number(row.chunks),
    last_ingested_at: row.last_ingested_at
  }));
}

export async function deleteKnowledgeSource(input: {
  userId: string;
  sourceType: "pdf" | "website" | "manual";
  sourceName: string;
}): Promise<number> {
  const normalizedSourceName = input.sourceName.replace(/\s+/g, " ").trim();

  return withTransaction(async (client) => {
    const result = await client.query<{ deleted_count: string }>(
      `WITH deleted AS (
         DELETE FROM knowledge_base
         WHERE user_id = $1
           AND source_type = $2
           AND (
             source_name = $3
             OR LOWER(TRIM(COALESCE(source_name, ''))) = LOWER(TRIM($3))
             OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(source_name, ''))), '[[:space:]]+', ' ', 'g') = LOWER($4)
           )
         RETURNING id
       )
       SELECT COUNT(*)::text AS deleted_count FROM deleted`,
      [input.userId, input.sourceType, input.sourceName, normalizedSourceName.toLowerCase()]
    );

    await client.query(
      `DELETE FROM knowledge_ingest_jobs
       WHERE user_id = $1
         AND source_type = $2
         AND (
           source_name = $3
           OR LOWER(TRIM(COALESCE(source_name, ''))) = LOWER(TRIM($3))
           OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(source_name, ''))), '[[:space:]]+', ' ', 'g') = LOWER($4)
         )`,
      [input.userId, input.sourceType, input.sourceName, normalizedSourceName.toLowerCase()]
    );

    return Number(result.rows[0]?.deleted_count ?? 0);
  });
}

export async function listKnowledgeChunks(input: {
  userId: string;
  sourceType?: "pdf" | "website" | "manual";
  sourceName?: string;
  limit?: number;
}): Promise<KnowledgeChunkPreview[]> {
  const limit = Math.max(1, Math.min(200, input.limit ?? 80));
  const result = await pool.query<{
    id: string;
    content_chunk: string;
    source_type: string;
    source_name: string | null;
    metadata_json: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT id, content_chunk, source_type, source_name, metadata_json, created_at
     FROM knowledge_base
     WHERE user_id = $1
       AND ($2::text IS NULL OR source_type = $2)
       AND ($3::text IS NULL OR source_name = $3)
     ORDER BY created_at DESC
     LIMIT $4`,
    [input.userId, input.sourceType ?? null, input.sourceName ?? null, limit]
  );

  return result.rows;
}
