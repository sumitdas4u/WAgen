import { pool } from "../db/pool.js";

export interface ConversationNote {
  id: string;
  conversation_id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export async function listConversationNotes(
  userId: string,
  conversationId: string
): Promise<ConversationNote[]> {
  const result = await pool.query<ConversationNote>(
    `SELECT n.id, n.conversation_id, n.user_id, n.author_name, n.content, n.created_at, n.updated_at
     FROM conversation_notes n
     JOIN conversations c ON c.id = n.conversation_id
     WHERE n.conversation_id = $1
       AND c.user_id = $2
     ORDER BY n.created_at DESC`,
    [conversationId, userId]
  );

  return result.rows;
}

export async function createConversationNote(input: {
  userId: string;
  conversationId: string;
  authorName: string;
  content: string;
}): Promise<ConversationNote> {
  const trimmedContent = input.content.trim();
  if (!trimmedContent) {
    throw new Error("Note content is required.");
  }

  const result = await pool.query<ConversationNote>(
    `INSERT INTO conversation_notes (conversation_id, user_id, author_name, content)
     SELECT c.id, c.user_id, $3, $4
     FROM conversations c
     WHERE c.id = $1
       AND c.user_id = $2
     RETURNING id, conversation_id, user_id, author_name, content, created_at, updated_at`,
    [input.conversationId, input.userId, input.authorName.trim() || "Agent", trimmedContent]
  );

  if (!result.rows[0]) {
    throw new Error("Conversation not found.");
  }

  return result.rows[0];
}
