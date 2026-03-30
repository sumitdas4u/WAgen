import { pool } from "../db/pool.js";

export interface FlowTrigger {
  id: string;
  type: "keyword" | "any_message" | "template_reply" | "qr_start" | "website_start";
  value: string;
}

export interface FlowRow {
  id: string;
  user_id: string;
  name: string;
  channel: "web" | "qr" | "api";
  nodes: unknown[];
  edges: unknown[];
  triggers: FlowTrigger[];
  variables: Record<string, unknown>;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export async function listFlows(userId: string): Promise<FlowRow[]> {
  const res = await pool.query<FlowRow>(
    `SELECT id, user_id, name, channel, nodes, edges, triggers, variables, published, created_at, updated_at
     FROM flows
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function getFlow(userId: string, flowId: string): Promise<FlowRow | null> {
  const res = await pool.query<FlowRow>(
    `SELECT id, user_id, name, channel, nodes, edges, triggers, variables, published, created_at, updated_at
     FROM flows
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [flowId, userId]
  );
  return res.rows[0] ?? null;
}

export async function createFlow(
  userId: string,
  data: { name?: string; channel?: "web" | "qr" | "api"; nodes?: unknown[]; edges?: unknown[]; triggers?: FlowTrigger[] }
): Promise<FlowRow> {
  const res = await pool.query<FlowRow>(
    `INSERT INTO flows (user_id, name, channel, nodes, edges, triggers)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      userId,
      data.name ?? "Untitled Flow",
      data.channel ?? "api",
      JSON.stringify(data.nodes ?? []),
      JSON.stringify(data.edges ?? []),
      JSON.stringify(data.triggers ?? [])
    ]
  );
  return res.rows[0];
}

export async function updateFlow(
  userId: string,
  flowId: string,
  data: { name?: string; nodes?: unknown[]; edges?: unknown[]; triggers?: FlowTrigger[] }
): Promise<FlowRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(data.name);
  }
  if (data.nodes !== undefined) {
    fields.push(`nodes = $${i++}`);
    values.push(JSON.stringify(data.nodes));
  }
  if (data.edges !== undefined) {
    fields.push(`edges = $${i++}`);
    values.push(JSON.stringify(data.edges));
  }
  if (data.triggers !== undefined) {
    fields.push(`triggers = $${i++}`);
    values.push(JSON.stringify(data.triggers));
  }

  if (!fields.length) return getFlow(userId, flowId);

  values.push(flowId, userId);
  const res = await pool.query<FlowRow>(
    `UPDATE flows SET ${fields.join(", ")}
     WHERE id = $${i++} AND user_id = $${i++}
     RETURNING *`,
    values
  );
  return res.rows[0] ?? null;
}

export async function deleteFlow(userId: string, flowId: string): Promise<boolean> {
  const res = await pool.query(
    "DELETE FROM flows WHERE id = $1 AND user_id = $2 RETURNING id",
    [flowId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function publishFlow(
  userId: string,
  flowId: string,
  publish: boolean
): Promise<FlowRow | null> {
  const res = await pool.query<FlowRow>(
    `UPDATE flows SET published = $1
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [publish, flowId, userId]
  );
  return res.rows[0] ?? null;
}

export async function getPublishedFlowsForUser(
  userId: string,
  channel?: "web" | "qr" | "api"
): Promise<FlowRow[]> {
  const res = await pool.query<FlowRow>(
    `SELECT id, user_id, name, channel, nodes, edges, triggers, variables, published, created_at, updated_at
     FROM flows
     WHERE user_id = $1 AND published = TRUE${channel ? " AND channel = $2" : ""}
     ORDER BY created_at ASC, id ASC`,
    channel ? [userId, channel] : [userId]
  );
  return res.rows;
}

// ─── Session helpers ──────────────────────────────────────────────────────────

export interface FlowSessionRow {
  id: string;
  flow_id: string;
  conversation_id: string;
  current_node_id: string | null;
  status: "active" | "waiting" | "completed" | "failed" | "ai_mode";
  variables: Record<string, unknown>;
  waiting_for: "button" | "message" | "location" | "payment" | "ai_reply" | null;
  waiting_node_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getActiveFlowSession(conversationId: string): Promise<FlowSessionRow | null> {
  const res = await pool.query<FlowSessionRow>(
    `SELECT * FROM flow_sessions
     WHERE conversation_id = $1
       AND status IN ('active', 'waiting', 'ai_mode')
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId]
  );
  return res.rows[0] ?? null;
}

export async function createFlowSession(
  flowId: string,
  conversationId: string
): Promise<FlowSessionRow> {
  const res = await pool.query<FlowSessionRow>(
    `INSERT INTO flow_sessions (flow_id, conversation_id, status, variables)
     VALUES ($1, $2, 'active', '{}')
     RETURNING *`,
    [flowId, conversationId]
  );
  return res.rows[0];
}

export async function updateFlowSession(
  sessionId: string,
  updates: {
    current_node_id?: string | null;
    status?: FlowSessionRow["status"];
    variables?: Record<string, unknown>;
    waiting_for?: FlowSessionRow["waiting_for"] | null;
    waiting_node_id?: string | null;
  }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if ("current_node_id" in updates) {
    fields.push(`current_node_id = $${i++}`);
    values.push(updates.current_node_id ?? null);
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${i++}`);
    values.push(updates.status);
  }
  if (updates.variables !== undefined) {
    fields.push(`variables = $${i++}`);
    values.push(JSON.stringify(updates.variables));
  }
  if ("waiting_for" in updates) {
    fields.push(`waiting_for = $${i++}`);
    values.push(updates.waiting_for ?? null);
  }
  if ("waiting_node_id" in updates) {
    fields.push(`waiting_node_id = $${i++}`);
    values.push(updates.waiting_node_id ?? null);
  }

  if (!fields.length) return;
  values.push(sessionId);
  await pool.query(
    `UPDATE flow_sessions SET ${fields.join(", ")} WHERE id = $${i}`,
    values
  );
}
