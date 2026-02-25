export interface SemanticChunk {
  text: string;
  start: number;
  end: number;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitSentences(paragraph: string): string[] {
  const normalized = paragraph.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [normalized];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

export function semanticChunkText(
  raw: string,
  options?: { targetTokens?: number; overlapTokens?: number; maxChunks?: number }
): SemanticChunk[] {
  const targetTokens = Math.max(250, options?.targetTokens ?? 650);
  const overlapTokens = Math.max(30, options?.overlapTokens ?? 110);
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const maxChunks =
    options?.maxChunks === 0
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, options?.maxChunks ?? 120);

  const text = normalizeWhitespace(raw);
  if (!text) {
    return [];
  }

  const paragraphs = text.split(/\n{2,}/g).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: SemanticChunk[] = [];
  let cursor = 0;
  let buffer = "";
  let bufferStart = 0;

  const flush = () => {
    const out = buffer.trim();
    if (!out) {
      return;
    }

    const start = bufferStart;
    const end = start + out.length;
    chunks.push({ text: out, start, end });
    buffer = "";
    bufferStart = end;
  };

  for (const paragraph of paragraphs) {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) {
      continue;
    }

    for (const sentence of sentences) {
      const next = buffer ? `${buffer} ${sentence}` : sentence;
      if (next.length <= targetChars) {
        if (!buffer) {
          bufferStart = cursor;
        }
        buffer = next;
        cursor += sentence.length + 1;
        continue;
      }

      flush();
      if (chunks.length >= maxChunks) {
        return chunks;
      }

      if (sentence.length <= targetChars) {
        buffer = sentence;
        bufferStart = cursor;
        cursor += sentence.length + 1;
        continue;
      }

      let sentenceCursor = 0;
      while (sentenceCursor < sentence.length) {
        const slice = sentence.slice(sentenceCursor, sentenceCursor + targetChars).trim();
        if (slice) {
          chunks.push({
            text: slice,
            start: cursor + sentenceCursor,
            end: cursor + sentenceCursor + slice.length
          });
        }
        if (chunks.length >= maxChunks) {
          return chunks;
        }
        sentenceCursor += Math.max(1, targetChars - overlapChars);
      }
      cursor += sentence.length + 1;
    }

    if (buffer) {
      buffer = `${buffer}\n\n`;
    }
    cursor += 2;
  }

  flush();
  return chunks.slice(0, maxChunks);
}
