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

const ZERO_VECTOR = toVectorLiteral(Array.from({ length: 1536 }, () => 0));

export async function ingestKnowledgeChunks(input: {
  userId: string;
  sourceType: "pdf" | "website" | "manual";
  sourceName?: string;
  chunks: string[];
}): Promise<number> {
  const validChunks = input.chunks.map((chunk) => chunk.trim()).filter(Boolean);
  if (validChunks.length === 0) {
    return 0;
  }

  if (!openAIService.isConfigured()) {
    throw new Error("OPENAI_API_KEY is missing. Cannot ingest knowledge without embeddings.");
  }

  await withTransaction(async (client) => {
    for (const chunk of validChunks) {
      let vectorLiteral = ZERO_VECTOR;
      try {
        const embedding = await openAIService.embed(chunk);
        vectorLiteral = toVectorLiteral(embedding);
      } catch {
        // Fallback when embedding models are unavailable for this project.
        vectorLiteral = ZERO_VECTOR;
      }

      await client.query(
        `INSERT INTO knowledge_base (user_id, source_type, source_name, content_chunk, embedding_vector)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [input.userId, input.sourceType, input.sourceName ?? null, chunk, vectorLiteral]
      );
    }
  });

  return validChunks.length;
}

export async function retrieveKnowledge(input: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<KnowledgeChunk[]> {
  const limit = input.limit ?? 5;

  if (!openAIService.isConfigured()) {
    return [];
  }

  try {
    const embedding = await openAIService.embed(input.query);
    const vectorLiteral = toVectorLiteral(embedding);

    const result = await pool.query<KnowledgeChunk>(
      `SELECT
        id,
        content_chunk,
        source_type,
        source_name,
        1 - (embedding_vector <=> $2::vector) AS similarity
       FROM knowledge_base
       WHERE user_id = $1
       ORDER BY embedding_vector <=> $2::vector
       LIMIT $3`,
      [input.userId, vectorLiteral, limit]
    );

    return result.rows;
  } catch {
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
