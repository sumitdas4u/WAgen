export function chunkText(input: string, maxChunkSize = 900, overlap = 120): string[] {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + maxChunkSize, normalized.length);
    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end === normalized.length) {
      break;
    }
    cursor = Math.max(0, end - overlap);
  }

  return chunks;
}