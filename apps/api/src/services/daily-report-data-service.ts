import { pool } from "../db/pool.js";

type MetricCount = {
  count: number;
  percent: number | null;
};

type PriorityConversation = {
  conversationId: string;
  contactLabel: string;
  phoneNumber: string;
  lastMessage: string;
  lastActivityAt: string | null;
  reason: string;
  suggestedAction: string;
  suggestedActionTag: string;
};

type ReportLead = {
  conversationId: string;
  displayName: string | null;
  phoneNumber: string;
  contactLabel: string;
  summary: string;
  score: number;
  status: string;
  lastMessage: string;
  lastActivityAt: string | null;
  suggestedAction: string;
  suggestedActionTag: string;
};

type ReportComplaint = {
  conversationId: string;
  displayName: string | null;
  phoneNumber: string;
  contactLabel: string;
  summary: string;
  sentiment: string | null;
  score: number;
  status: string;
  lastMessage: string;
  lastActivityAt: string | null;
  comparisonNote: string;
};

type ReportFeedback = {
  conversationId: string;
  displayName: string | null;
  phoneNumber: string;
  contactLabel: string;
  summary: string;
  sentiment: string | null;
  status: string;
  lastActivityAt: string | null;
  insight: string;
  repeatCount: number;
};

type UnansweredQuestion = {
  conversationId: string | null;
  contactLabel: string;
  phoneNumber: string;
  question: string;
  confidenceScore: number;
  createdAt: string;
  kbSuggestion: string;
};

type TimelineEvent = {
  time: string;
  contactLabel: string;
  eventType: "inbound" | "outbound" | "ai_alert";
  description: string;
};

export type DailyReportSnapshot = {
  date: string;
  range: {
    dateLabel: string;
    startAt: string;
    endAt: string;
  };
  overview: {
    totalConversations: number;
    leads: number;
    complaints: number;
    feedback: number;
    responseRate: number | null;
    avgResponseTimeMinutes: number | null;
    aiHandled: MetricCount;
    humanTakeover: MetricCount;
  };
  priority: {
    staleLeads: PriorityConversation[];
    stuckConversations: PriorityConversation[];
    lowConfidenceChats: UnansweredQuestion[];
  };
  topLeads: ReportLead[];
  topComplaints: ReportComplaint[];
  topFeedback: ReportFeedback[];
  aiPerformance: {
    aiHandled: MetricCount;
    humanTakeover: MetricCount;
    failedResponses: number;
    unansweredQuestions: UnansweredQuestion[];
    kbSuggestions: string[];
  };
  insights: string[];
  improvements: string[];
  timeline: TimelineEvent[];
  comparisons: {
    leadsDelta: number;
    complaintsDelta: number;
    feedbackDelta: number;
    responseRateDelta: number | null;
    summary: string[];
  };
  broadcasts: {
    sent: number;
    delivered: number;
    failed: number;
  };
  automation: {
    sequencesCompleted: number;
    flowsCompleted: number;
  };
  alerts: string[];
};

type ConversationRow = {
  conversation_id: string;
  phone_number: string;
  display_name: string | null;
  lead_kind: string;
  stage: string;
  score: number;
  manual_takeover: boolean;
  last_ai_reply_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  insight_type: string | null;
  insight_summary: string | null;
  insight_sentiment: string | null;
  insight_priority_score: number | null;
  insight_status: string | null;
  lead_summary: string | null;
};

type MessageRow = {
  conversation_id: string;
  phone_number: string;
  display_name: string | null;
  direction: "inbound" | "outbound";
  message_text: string;
  created_at: string;
};

type AiReviewRow = {
  id: string;
  conversation_id: string | null;
  customer_phone: string;
  question: string;
  confidence_score: number;
  status: "pending" | "resolved";
  created_at: string;
  display_name: string | null;
};

type BroadcastRow = {
  sent_count: string;
  delivered_count: string;
  failed_count: string;
};

type AutomationRow = {
  sequences_completed: string;
  flows_completed: string;
};

type ReportConversation = {
  id: string;
  phoneNumber: string;
  displayName: string | null;
  contactLabel: string;
  kind: "lead" | "complaint" | "feedback" | "other";
  stage: string;
  score: number;
  manualTakeover: boolean;
  lastAiReplyAt: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  summary: string;
  sentiment: string | null;
  priorityScore: number;
  insightStatus: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_LEAD_MINUTES = 120;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(dateLike: string | Date | null | undefined): string {
  if (!dateLike) {
    return "";
  }

  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function toPercent(count: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }

  return Math.round((count / total) * 100);
}

function clampList<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

function minutesSince(timestamp: string | null, now: Date): number | null {
  if (!timestamp) {
    return null;
  }

  const diff = now.getTime() - new Date(timestamp).getTime();
  return diff >= 0 ? Math.round(diff / 60000) : null;
}

function contactLabel(displayName: string | null, phoneNumber: string): string {
  return displayName?.trim() ? `${displayName.trim()} (${phoneNumber})` : phoneNumber;
}

function normalizeKind(value: string | null | undefined): "lead" | "complaint" | "feedback" | "other" {
  if (value === "lead" || value === "complaint" || value === "feedback") {
    return value;
  }

  return "other";
}

function summarizeDelta(label: string, delta: number, emptyText: string): string {
  if (delta === 0) {
    return emptyText;
  }

  return delta > 0
    ? `${label} up by ${delta} vs yesterday`
    : `${label} down by ${Math.abs(delta)} vs yesterday`;
}

function keywordTheme(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/(price|pricing|cost|offer|discount|combo|package)/.test(normalized)) return "pricing";
  if (/(delivery|ship|shipping|when|time)/.test(normalized)) return "delivery";
  if (/(complaint|issue|problem|bad|wrong|late)/.test(normalized)) return "support";
  if (/(quality|happy|good|great|love)/.test(normalized)) return "feedback";
  return null;
}

function buildKnowledgeSuggestion(question: string): string {
  const normalized = question.toLowerCase();

  if (/(price|pricing|offer|discount|combo|package)/.test(normalized)) {
    return 'Add FAQ: "Pricing & offers"';
  }
  if (/(delivery|shipping|eta|arrive|when)/.test(normalized)) {
    return 'Add FAQ: "Delivery timelines"';
  }
  if (/(location|address|where|map)/.test(normalized)) {
    return 'Add FAQ: "Store location & directions"';
  }

  return "Review unanswered question and add it to the knowledge base";
}

function deriveLeadAction(conversation: ReportConversation, now: Date): {
  suggestedAction: string;
  suggestedActionTag: string;
} {
  const minutes = minutesSince(conversation.lastMessageAt, now) ?? 0;

  if (minutes >= STALE_LEAD_MINUTES && conversation.priorityScore >= 50) {
    return {
      suggestedAction: "Follow up within 30 mins before the lead cools down",
      suggestedActionTag: "Follow up"
    };
  }

  if (conversation.priorityScore >= 70) {
    return {
      suggestedAction: "Call or send a direct reply now while interest is high",
      suggestedActionTag: "Hot"
    };
  }

  if (conversation.priorityScore >= 40) {
    return {
      suggestedAction: "Send pricing, package, or offer details next",
      suggestedActionTag: "Warm"
    };
  }

  return {
    suggestedAction: "Nudge with an offer or discount to restart the conversation",
    suggestedActionTag: "Nurture"
  };
}

function deriveFeedbackInsight(summary: string, sentiment: string | null): string {
  if (sentiment === "positive") {
    return "Service quality sentiment is positive today";
  }
  if (sentiment === "negative" || sentiment === "angry" || sentiment === "frustrated") {
    return "Feedback points to a service experience gap worth reviewing";
  }
  if (/price|pricing|offer|discount/i.test(summary)) {
    return "Customers are reacting to pricing or offer positioning";
  }

  return "Capture this pattern and reuse it in future messaging";
}

function buildComplaintComparison(todayCount: number, yesterdayCount: number): string {
  if (todayCount === 0) {
    return yesterdayCount > 0 ? `Good performance — down from ${yesterdayCount} yesterday` : "Good performance — no complaints today";
  }

  if (yesterdayCount === 0) {
    return "New complaint activity compared with yesterday";
  }

  if (todayCount > yesterdayCount) {
    return `Complaint volume increased from ${yesterdayCount} yesterday`;
  }

  if (todayCount < yesterdayCount) {
    return `Complaint volume improved from ${yesterdayCount} yesterday`;
  }

  return "Complaint volume is flat vs yesterday";
}

async function queryConversationsWindow(userId: string, start: Date, end: Date): Promise<ReportConversation[]> {
  const result = await pool.query<ConversationRow>(
    `SELECT
       c.id AS conversation_id,
       c.phone_number,
       ct.display_name,
       c.lead_kind,
       c.stage,
       c.score,
       c.manual_takeover,
       c.last_ai_reply_at::text,
       c.last_message,
       c.last_message_at::text,
       ci.type AS insight_type,
       ci.summary AS insight_summary,
       ci.sentiment AS insight_sentiment,
       ci.priority_score AS insight_priority_score,
       ci.status AS insight_status,
       ls.summary_text AS lead_summary
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = c.user_id
         AND (ct.linked_conversation_id = c.id OR ct.phone_number = c.phone_number)
       ORDER BY CASE WHEN ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     LEFT JOIN conversation_insights ci ON ci.conversation_id = c.id
     LEFT JOIN lead_summaries ls ON ls.conversation_id = c.id
     WHERE c.user_id = $1
       AND c.last_message_at >= $2
       AND c.last_message_at < $3
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [userId, start, end]
  );

  return result.rows.map((row) => {
    const kind = normalizeKind(row.insight_type ?? row.lead_kind);
    const display = row.display_name?.trim() || null;
    const summary =
      row.lead_summary?.trim() ||
      row.insight_summary?.trim() ||
      row.last_message?.trim() ||
      "No summary available";

    return {
      id: row.conversation_id,
      phoneNumber: row.phone_number,
      displayName: display,
      contactLabel: contactLabel(display, row.phone_number),
      kind,
      stage: row.stage,
      score: row.score,
      manualTakeover: row.manual_takeover,
      lastAiReplyAt: row.last_ai_reply_at,
      lastMessage: row.last_message?.trim() || "",
      lastMessageAt: row.last_message_at,
      summary,
      sentiment: row.insight_sentiment,
      priorityScore: row.insight_priority_score ?? row.score ?? 0,
      insightStatus: row.insight_status ?? row.stage
    };
  });
}

async function queryMessagesWindow(
  userId: string,
  start: Date,
  end: Date
): Promise<MessageRow[]> {
  const result = await pool.query<MessageRow>(
    `SELECT
       cm.conversation_id,
       c.phone_number,
       ct.display_name,
       cm.direction,
       cm.message_text,
       cm.created_at::text
     FROM conversation_messages cm
     JOIN conversations c ON c.id = cm.conversation_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = c.user_id
         AND (ct.linked_conversation_id = c.id OR ct.phone_number = c.phone_number)
       ORDER BY CASE WHEN ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     WHERE c.user_id = $1
       AND cm.created_at >= $2
       AND cm.created_at < $3
     ORDER BY cm.created_at ASC`,
    [userId, start, end]
  );

  return result.rows;
}

async function queryAiReviewWindow(userId: string, start: Date, end: Date): Promise<AiReviewRow[]> {
  const result = await pool.query<AiReviewRow>(
    `SELECT
       q.id,
       q.conversation_id,
       q.customer_phone,
       q.question,
       q.confidence_score,
       q.status,
       q.created_at::text,
       ct.display_name
     FROM ai_review_queue q
     LEFT JOIN conversations c ON c.id = q.conversation_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM contacts ct
       WHERE ct.user_id = q.user_id
         AND (
           (c.id IS NOT NULL AND ct.linked_conversation_id = c.id)
           OR ct.phone_number = q.customer_phone
         )
       ORDER BY CASE WHEN c.id IS NOT NULL AND ct.linked_conversation_id = c.id THEN 0 ELSE 1 END, ct.updated_at DESC
       LIMIT 1
     ) ct ON TRUE
     WHERE q.user_id = $1
       AND q.created_at >= $2
       AND q.created_at < $3
     ORDER BY q.confidence_score ASC, q.created_at DESC`,
    [userId, start, end]
  );

  return result.rows;
}

async function queryBroadcastStats(userId: string, start: Date, end: Date): Promise<BroadcastRow> {
  try {
    const result = await pool.query<BroadcastRow>(
      `SELECT
         COALESCE(SUM(sent_count), 0)::text AS sent_count,
         COALESCE(SUM(delivered_count), 0)::text AS delivered_count,
         COALESCE(SUM(failed_count), 0)::text AS failed_count
       FROM campaigns
       WHERE user_id = $1
         AND status = 'completed'
         AND completed_at >= $2
         AND completed_at < $3`,
      [userId, start, end]
    );

    return result.rows[0] ?? { sent_count: "0", delivered_count: "0", failed_count: "0" };
  } catch {
    return { sent_count: "0", delivered_count: "0", failed_count: "0" };
  }
}

async function queryAutomationStats(userId: string, start: Date, end: Date): Promise<AutomationRow> {
  let sequencesCompleted = "0";
  let flowsCompleted = "0";

  try {
    const seqResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM sequence_enrollments
       WHERE sequence_id IN (SELECT id FROM sequences WHERE user_id = $1)
         AND status = 'completed'
         AND updated_at >= $2
         AND updated_at < $3`,
      [userId, start, end]
    );
    sequencesCompleted = seqResult.rows[0]?.count ?? "0";
  } catch {
    sequencesCompleted = "0";
  }

  try {
    const flowResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM flow_sessions
       WHERE user_id = $1
         AND status = 'completed'
         AND updated_at >= $2
         AND updated_at < $3`,
      [userId, start, end]
    );
    flowsCompleted = flowResult.rows[0]?.count ?? "0";
  } catch {
    flowsCompleted = "0";
  }

  return {
    sequences_completed: sequencesCompleted,
    flows_completed: flowsCompleted
  };
}

function computeResponseMetrics(messages: MessageRow[]): {
  responseRate: number | null;
  avgResponseTimeMinutes: number | null;
} {
  if (messages.length === 0) {
    return { responseRate: null, avgResponseTimeMinutes: null };
  }

  const pendingInboundTimes: number[] = [];
  let inboundCount = 0;
  let respondedCount = 0;
  const responseTimes: number[] = [];

  for (const message of messages) {
    const timestamp = Date.parse(message.created_at);
    if (message.direction === "inbound") {
      inboundCount += 1;
      pendingInboundTimes.push(timestamp);
      continue;
    }

    if (pendingInboundTimes.length > 0) {
      const inboundAt = pendingInboundTimes.shift();
      if (inboundAt !== undefined && timestamp >= inboundAt) {
        respondedCount += 1;
        responseTimes.push(Math.max(0, Math.round((timestamp - inboundAt) / 60000)));
      }
    }
  }

  const responseRate = inboundCount > 0 ? Math.round((respondedCount / inboundCount) * 100) : null;
  const avgResponseTimeMinutes =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : null;

  return {
    responseRate,
    avgResponseTimeMinutes
  };
}

function buildPriority(
  conversations: ReportConversation[],
  unansweredQuestions: UnansweredQuestion[],
  now: Date
): DailyReportSnapshot["priority"] {
  const staleLeads = clampList(
    conversations
      .filter((conversation) => conversation.kind === "lead")
      .filter((conversation) => {
        const minutes = minutesSince(conversation.lastMessageAt, now);
        return conversation.priorityScore >= 50 && minutes !== null && minutes >= STALE_LEAD_MINUTES;
      })
      .sort((a, b) => (b.priorityScore - a.priorityScore) || ((Date.parse(a.lastMessageAt ?? "") || 0) - (Date.parse(b.lastMessageAt ?? "") || 0)))
      .map((conversation) => ({
        conversationId: conversation.id,
        contactLabel: conversation.contactLabel,
        phoneNumber: conversation.phoneNumber,
        lastMessage: conversation.lastMessage,
        lastActivityAt: conversation.lastMessageAt,
        reason: "Warm lead waiting without follow-up for 2+ hours",
        suggestedAction: "Reach out now with a direct follow-up or pricing message",
        suggestedActionTag: "Lead"
      })),
    3
  );

  const stuckConversations = clampList(
    conversations
      .filter((conversation) => conversation.kind !== "other")
      .filter((conversation) => {
        const minutes = minutesSince(conversation.lastMessageAt, now);
        return minutes !== null && minutes >= STALE_LEAD_MINUTES;
      })
      .sort((a, b) => (Date.parse(a.lastMessageAt ?? "") || 0) - (Date.parse(b.lastMessageAt ?? "") || 0))
      .map((conversation) => ({
        conversationId: conversation.id,
        contactLabel: conversation.contactLabel,
        phoneNumber: conversation.phoneNumber,
        lastMessage: conversation.lastMessage,
        lastActivityAt: conversation.lastMessageAt,
        reason: "Conversation has been inactive and may need a reply",
        suggestedAction: conversation.manualTakeover
          ? "Human owner should reply and close the loop"
          : "Send a quick follow-up before the customer drops off",
        suggestedActionTag: conversation.manualTakeover ? "Human" : "Reply"
      })),
    3
  );

  return {
    staleLeads,
    stuckConversations,
    lowConfidenceChats: clampList(unansweredQuestions, 3)
  };
}

function buildTopLeads(conversations: ReportConversation[], now: Date): ReportLead[] {
  return clampList(
    conversations
      .filter((conversation) => conversation.kind === "lead")
      .sort((a, b) => (b.priorityScore - a.priorityScore) || (Date.parse(b.lastMessageAt ?? "") || 0) - (Date.parse(a.lastMessageAt ?? "") || 0))
      .map((conversation) => {
        const action = deriveLeadAction(conversation, now);
        return {
          conversationId: conversation.id,
          displayName: conversation.displayName,
          phoneNumber: conversation.phoneNumber,
          contactLabel: conversation.contactLabel,
          summary: conversation.summary,
          score: conversation.priorityScore,
          status: conversation.insightStatus,
          lastMessage: conversation.lastMessage,
          lastActivityAt: conversation.lastMessageAt,
          suggestedAction: action.suggestedAction,
          suggestedActionTag: action.suggestedActionTag
        };
      }),
    5
  );
}

function buildTopComplaints(
  conversations: ReportConversation[],
  yesterdayComplaintCount: number
): ReportComplaint[] {
  const todayComplaintCount = conversations.filter((conversation) => conversation.kind === "complaint").length;
  const comparisonNote = buildComplaintComparison(todayComplaintCount, yesterdayComplaintCount);

  return clampList(
    conversations
      .filter((conversation) => conversation.kind === "complaint")
      .sort((a, b) => (b.priorityScore - a.priorityScore) || (Date.parse(b.lastMessageAt ?? "") || 0) - (Date.parse(a.lastMessageAt ?? "") || 0))
      .map((conversation) => ({
        conversationId: conversation.id,
        displayName: conversation.displayName,
        phoneNumber: conversation.phoneNumber,
        contactLabel: conversation.contactLabel,
        summary: conversation.summary,
        sentiment: conversation.sentiment,
        score: conversation.priorityScore,
        status: conversation.insightStatus,
        lastMessage: conversation.lastMessage,
        lastActivityAt: conversation.lastMessageAt,
        comparisonNote
      })),
    5
  );
}

function buildTopFeedback(conversations: ReportConversation[]): ReportFeedback[] {
  const summaryCounts = new Map<string, number>();

  for (const conversation of conversations) {
    if (conversation.kind !== "feedback") {
      continue;
    }

    const key = conversation.summary.trim().toLowerCase();
    summaryCounts.set(key, (summaryCounts.get(key) ?? 0) + 1);
  }

  return clampList(
    conversations
      .filter((conversation) => conversation.kind === "feedback")
      .sort((a, b) => (b.priorityScore - a.priorityScore) || (Date.parse(b.lastMessageAt ?? "") || 0) - (Date.parse(a.lastMessageAt ?? "") || 0))
      .map((conversation) => ({
        conversationId: conversation.id,
        displayName: conversation.displayName,
        phoneNumber: conversation.phoneNumber,
        contactLabel: conversation.contactLabel,
        summary: conversation.summary,
        sentiment: conversation.sentiment,
        status: conversation.insightStatus,
        lastActivityAt: conversation.lastMessageAt,
        insight: deriveFeedbackInsight(conversation.summary, conversation.sentiment),
        repeatCount: summaryCounts.get(conversation.summary.trim().toLowerCase()) ?? 1
      })),
    5
  );
}

function buildUnansweredQuestions(aiReviews: AiReviewRow[]): UnansweredQuestion[] {
  return clampList(
    aiReviews.map((row) => ({
      conversationId: row.conversation_id,
      contactLabel: contactLabel(row.display_name?.trim() || null, row.customer_phone),
      phoneNumber: row.customer_phone,
      question: row.question,
      confidenceScore: row.confidence_score,
      createdAt: row.created_at,
      kbSuggestion: buildKnowledgeSuggestion(row.question)
    })),
    5
  );
}

function buildTimeline(messages: MessageRow[], unansweredQuestions: UnansweredQuestion[]): TimelineEvent[] {
  const messageEvents: TimelineEvent[] = messages.map((message) => ({
    time: formatTime(message.created_at),
    contactLabel: contactLabel(message.display_name?.trim() || null, message.phone_number),
    eventType: message.direction,
    description:
      message.direction === "inbound"
        ? `Customer asked: "${message.message_text.trim().slice(0, 120)}"`
        : `Reply sent: "${message.message_text.trim().slice(0, 120)}"`
  }));

  const reviewEvents: TimelineEvent[] = unansweredQuestions.map((item) => ({
    time: formatTime(item.createdAt),
    contactLabel: item.contactLabel,
    eventType: "ai_alert",
    description: `Low AI confidence: "${item.question.slice(0, 120)}"`
  }));

  return [...messageEvents, ...reviewEvents]
    .sort((a, b) => {
      const aTime = Date.parse(`1970-01-01T${a.time.includes("M") ? new Date(`2000-01-01 ${a.time}`).toTimeString().slice(0, 8) : "00:00:00"}`);
      const bTime = Date.parse(`1970-01-01T${b.time.includes("M") ? new Date(`2000-01-01 ${b.time}`).toTimeString().slice(0, 8) : "00:00:00"}`);
      return bTime - aTime;
    })
    .slice(0, 8);
}

function buildInsights(params: {
  conversations: ReportConversation[];
  messages: MessageRow[];
  unansweredQuestions: UnansweredQuestion[];
  priority: DailyReportSnapshot["priority"];
}): string[] {
  const insights: string[] = [];
  const hourCounts = new Map<number, number>();
  const themeCounts = new Map<string, number>();

  for (const conversation of params.conversations) {
    if (conversation.lastMessageAt) {
      const hour = new Date(conversation.lastMessageAt).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    const theme = keywordTheme(`${conversation.lastMessage} ${conversation.summary}`);
    if (theme) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
  }

  for (const item of params.unansweredQuestions) {
    const theme = keywordTheme(item.question);
    if (theme) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
  }

  const topHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topHour) {
    const startHour = topHour[0];
    const start = new Date();
    start.setHours(startHour, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    insights.push(`Peak time: ${formatTime(start)} - ${formatTime(end)}`);
  }

  const topTheme = [...themeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTheme?.[0] === "pricing") insights.push("Most asked topic today: pricing and offers");
  if (topTheme?.[0] === "delivery") insights.push("Delivery timing questions are recurring today");
  if (topTheme?.[0] === "support") insights.push("Support-related friction showed up repeatedly today");
  if (topTheme?.[0] === "feedback") insights.push("Feedback themes are shaping the day’s conversations");

  if (params.priority.staleLeads.length > 0) {
    insights.push(`${params.priority.staleLeads.length} warm lead${params.priority.staleLeads.length > 1 ? "s are" : " is"} waiting too long for a follow-up`);
  }

  const outboundCount = params.messages.filter((message) => message.direction === "outbound").length;
  const inboundCount = params.messages.filter((message) => message.direction === "inbound").length;
  if (inboundCount > outboundCount && inboundCount > 0) {
    insights.push("Drop-off risk is rising because inbound demand is outpacing replies");
  }

  return clampList(insights, 4);
}

function buildImprovements(params: {
  unansweredQuestions: UnansweredQuestion[];
  priority: DailyReportSnapshot["priority"];
  responseRate: number | null;
  complaintCount: number;
}): string[] {
  const improvements: string[] = [];

  if (params.unansweredQuestions.length > 0) {
    improvements.push(params.unansweredQuestions[0].kbSuggestion);
  }

  if (params.priority.staleLeads.length > 0) {
    improvements.push("Follow up warm leads faster, especially those inactive for 2+ hours");
  }

  if (params.responseRate !== null && params.responseRate < 80) {
    improvements.push("Improve response speed during peak hours to raise response coverage");
  }

  if (params.complaintCount > 0) {
    improvements.push("Review complaint conversations and prepare a faster recovery response");
  }

  if (improvements.length === 0) {
    improvements.push("Daily report is healthy today — keep reply speed and FAQ coverage consistent");
  }

  return [...new Set(improvements)].slice(0, 4);
}

function buildAlerts(params: {
  broadcastFailed: number;
  broadcastSent: number;
  priority: DailyReportSnapshot["priority"];
  unansweredQuestions: UnansweredQuestion[];
}): string[] {
  const alerts: string[] = [];

  if (params.broadcastSent > 0 && params.broadcastFailed / params.broadcastSent > 0.05) {
    alerts.push(`High broadcast failure rate — ${params.broadcastFailed} of ${params.broadcastSent} failed`);
  }

  if (params.priority.staleLeads.length > 0) {
    alerts.push(`${params.priority.staleLeads.length} lead${params.priority.staleLeads.length > 1 ? "s" : ""} need follow-up within 30 minutes`);
  }

  if (params.unansweredQuestions.length > 0) {
    alerts.push(`${params.unansweredQuestions.length} low-confidence chat${params.unansweredQuestions.length > 1 ? "s" : ""} need AI review`);
  }

  return alerts;
}

export async function fetchDailyReportData(userId: string, start: Date): Promise<DailyReportSnapshot> {
  const startAt = new Date(start);
  startAt.setHours(0, 0, 0, 0);
  const endAt = new Date(startAt.getTime() + DAY_MS);
  const yesterdayStart = new Date(startAt.getTime() - DAY_MS);
  const yesterdayEnd = new Date(startAt.getTime());

  const [
    conversations,
    messages,
    aiReviews,
    broadcast,
    automation,
    yesterdayConversations,
    yesterdayMessages
  ] = await Promise.all([
    queryConversationsWindow(userId, startAt, endAt),
    queryMessagesWindow(userId, startAt, endAt),
    queryAiReviewWindow(userId, startAt, endAt),
    queryBroadcastStats(userId, startAt, endAt),
    queryAutomationStats(userId, startAt, endAt),
    queryConversationsWindow(userId, yesterdayStart, yesterdayEnd),
    queryMessagesWindow(userId, yesterdayStart, yesterdayEnd)
  ]);

  const unansweredQuestions = buildUnansweredQuestions(aiReviews);
  const responseMetrics = computeResponseMetrics(messages);
  const yesterdayResponseMetrics = computeResponseMetrics(yesterdayMessages);

  const totalConversations = conversations.length;
  const leads = conversations.filter((conversation) => conversation.kind === "lead").length;
  const complaints = conversations.filter((conversation) => conversation.kind === "complaint").length;
  const feedback = conversations.filter((conversation) => conversation.kind === "feedback").length;
  const humanTakeoverCount = conversations.filter((conversation) => conversation.manualTakeover).length;
  const aiHandledCount = Math.max(0, totalConversations - humanTakeoverCount);

  const aiHandled = {
    count: aiHandledCount,
    percent: toPercent(aiHandledCount, totalConversations)
  };
  const humanTakeover = {
    count: humanTakeoverCount,
    percent: toPercent(humanTakeoverCount, totalConversations)
  };

  const priority = buildPriority(conversations, unansweredQuestions, endAt);
  const topLeads = buildTopLeads(conversations, endAt);
  const topComplaints = buildTopComplaints(
    conversations,
    yesterdayConversations.filter((conversation) => conversation.kind === "complaint").length
  );
  const topFeedback = buildTopFeedback(conversations);
  const insights = buildInsights({
    conversations,
    messages,
    unansweredQuestions,
    priority
  });
  const improvements = buildImprovements({
    unansweredQuestions,
    priority,
    responseRate: responseMetrics.responseRate,
    complaintCount: complaints
  });
  const timeline = buildTimeline(messages, unansweredQuestions);

  const comparisonsSummary = [
    summarizeDelta(
      "Leads",
      leads - yesterdayConversations.filter((conversation) => conversation.kind === "lead").length,
      "Lead volume is flat vs yesterday"
    ),
    summarizeDelta(
      "Complaints",
      complaints - yesterdayConversations.filter((conversation) => conversation.kind === "complaint").length,
      complaints === 0 ? "No complaints today" : "Complaint volume is flat vs yesterday"
    ),
    summarizeDelta(
      "Feedback",
      feedback - yesterdayConversations.filter((conversation) => conversation.kind === "feedback").length,
      "Feedback volume is flat vs yesterday"
    )
  ];

  const responseRateDelta =
    responseMetrics.responseRate !== null && yesterdayResponseMetrics.responseRate !== null
      ? responseMetrics.responseRate - yesterdayResponseMetrics.responseRate
      : null;

  const kbSuggestions = [...new Set(unansweredQuestions.map((item) => item.kbSuggestion))].slice(0, 4);
  const broadcastSent = parseInt(broadcast.sent_count, 10);
  const broadcastDelivered = parseInt(broadcast.delivered_count, 10);
  const broadcastFailed = parseInt(broadcast.failed_count, 10);

  return {
    date: formatLocalDateKey(startAt),
    range: {
      dateLabel: formatDateLabel(startAt),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString()
    },
    overview: {
      totalConversations,
      leads,
      complaints,
      feedback,
      responseRate: responseMetrics.responseRate,
      avgResponseTimeMinutes: responseMetrics.avgResponseTimeMinutes,
      aiHandled,
      humanTakeover
    },
    priority,
    topLeads,
    topComplaints,
    topFeedback,
    aiPerformance: {
      aiHandled,
      humanTakeover,
      failedResponses: unansweredQuestions.length,
      unansweredQuestions,
      kbSuggestions
    },
    insights,
    improvements,
    timeline,
    comparisons: {
      leadsDelta: leads - yesterdayConversations.filter((conversation) => conversation.kind === "lead").length,
      complaintsDelta: complaints - yesterdayConversations.filter((conversation) => conversation.kind === "complaint").length,
      feedbackDelta: feedback - yesterdayConversations.filter((conversation) => conversation.kind === "feedback").length,
      responseRateDelta,
      summary: comparisonsSummary
    },
    broadcasts: {
      sent: broadcastSent,
      delivered: broadcastDelivered,
      failed: broadcastFailed
    },
    automation: {
      sequencesCompleted: parseInt(automation.sequences_completed, 10),
      flowsCompleted: parseInt(automation.flows_completed, 10)
    },
    alerts: buildAlerts({
      broadcastFailed,
      broadcastSent,
      priority,
      unansweredQuestions
    })
  };
}
