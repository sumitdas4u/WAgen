import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { resolveReviewItem } from "./api";
import {
  buildReviewQueueQueryOptions,
  useReviewConversationQuery,
  useReviewQueueQuery
} from "./queries";

type ReviewStatusFilter = "all" | "pending" | "resolved";

function isSameLocalDay(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const current = new Date();
  const sample = new Date(value);
  return (
    current.getFullYear() === sample.getFullYear() &&
    current.getMonth() === sample.getMonth() &&
    current.getDate() === sample.getDate()
  );
}

function formatPhone(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return value;
  }
  return `+${digits}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function getReviewStatusLabel(status: "pending" | "resolved") {
  return status === "resolved" ? "Resolved" : "Needs review";
}

function getReviewSignalLabel(signal: string) {
  if (signal === "low_confidence") {
    return "Low confidence";
  }
  if (signal === "fallback_response") {
    return "Fallback reply";
  }
  if (signal === "no_knowledge_match") {
    return "No KB match";
  }
  if (signal === "user_negative_feedback") {
    return "User flagged wrong answer";
  }
  return signal.replace(/_/g, " ");
}

export function Component() {
  const queryClient = useQueryClient();
  const { token } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [reviewResolutionAnswer, setReviewResolutionAnswer] = useState("");
  const reviewStatusFilter = (searchParams.get("status") as ReviewStatusFilter | null) ?? "pending";

  const reviewQuery = useReviewQueueQuery(token, reviewStatusFilter);
  const selectedReview = useMemo(
    () => (reviewQuery.data ?? []).find((item) => item.id === selectedReviewId) ?? null,
    [reviewQuery.data, selectedReviewId]
  );

  useEffect(() => {
    if (!selectedReviewId && reviewQuery.data?.[0]) {
      setSelectedReviewId(reviewQuery.data[0].id);
    }
  }, [reviewQuery.data, selectedReviewId]);

  useEffect(() => {
    setReviewResolutionAnswer(selectedReview?.resolution_answer ?? "");
  }, [selectedReview?.id]);

  const reviewConversationQuery = useReviewConversationQuery(token, selectedReview?.conversation_id ?? null);

  const reviewHighlights = useMemo(
    () =>
      (reviewQuery.data ?? []).reduce(
        (acc, row) => {
          if (row.status === "pending") {
            acc.pending += 1;
          }
          if (row.status === "resolved" && isSameLocalDay(row.resolved_at)) {
            acc.resolvedToday += 1;
          }
          if (isSameLocalDay(row.created_at) && row.confidence_score < 70) {
            acc.lowConfidenceToday += 1;
          }
          return acc;
        },
        { pending: 0, resolvedToday: 0, lowConfidenceToday: 0 }
      ),
    [reviewQuery.data]
  );

  const resolveMutation = useMutation({
    mutationFn: ({ addToKnowledgeBase }: { addToKnowledgeBase: boolean }) =>
      resolveReviewItem(token, selectedReviewId as string, {
        resolutionAnswer: reviewResolutionAnswer.trim() || undefined,
        addToKnowledgeBase
      }),
    onSuccess: async ({ knowledgeChunks }) => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.reviewRoot });
      if (knowledgeChunks > 0) {
        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.knowledgeRoot });
      }
    }
  });

  return (
    <section className="ai-review-center">
      <div className="ai-review-head">
        <h2>AI Review & Learning Center</h2>
        <div className="clone-hero-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={reviewQuery.isFetching}
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.reviewRoot });
            }}
          >
            Refresh Queue
          </button>
        </div>
      </div>
      <p className="ai-review-copy">
        Improve your AI by reviewing low-confidence replies and unresolved conversations, then save corrected answers to
        Knowledge Base.
      </p>

      <div className="ai-review-cards">
        <article>
          <strong>{reviewHighlights.pending}</strong>
          <span>Pending review</span>
        </article>
        <article>
          <strong>{reviewHighlights.lowConfidenceToday}</strong>
          <span>Low confidence today</span>
        </article>
        <article>
          <strong>{reviewHighlights.resolvedToday}</strong>
          <span>Resolved today</span>
        </article>
      </div>

      <div className="ai-review-filters">
        {([
          { value: "pending", label: "Pending" },
          { value: "resolved", label: "Resolved" },
          { value: "all", label: "All" }
        ] as Array<{ value: ReviewStatusFilter; label: string }>).map((item) => (
          <button
            key={item.value}
            type="button"
            className={reviewStatusFilter === item.value ? "active" : ""}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (item.value === "pending") {
                next.delete("status");
              } else {
                next.set("status", item.value);
              }
              setSearchParams(next, { replace: true });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="ai-review-layout">
        <div className="ai-review-table-wrap finance-table-wrap">
          {reviewQuery.isLoading ? (
            <p className="empty-note">Loading review queue...</p>
          ) : (reviewQuery.data ?? []).length === 0 ? (
            <p className="empty-note">No conversations in this filter yet.</p>
          ) : (
            <table className="finance-table ai-review-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Question</th>
                  <th>AI Answer</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(reviewQuery.data ?? []).map((item) => (
                  <tr
                    key={item.id}
                    className={selectedReviewId === item.id ? "selected" : ""}
                    onClick={() => setSelectedReviewId(item.id)}
                  >
                    <td>
                      <strong>{formatPhone(item.customer_phone)}</strong>
                      <small>{formatDateTime(item.created_at)}</small>
                    </td>
                    <td>{item.question}</td>
                    <td>{item.ai_response}</td>
                    <td>
                      <span className={item.confidence_score < 70 ? "ai-review-confidence low" : "ai-review-confidence"}>
                        {item.confidence_score}%
                      </span>
                    </td>
                    <td>{getReviewStatusLabel(item.status)}</td>
                    <td>
                      <button type="button" className="ghost-btn" onClick={() => setSelectedReviewId(item.id)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="ai-review-detail">
          {!selectedReview ? (
            <p className="empty-note">Select a conversation to review.</p>
          ) : (
            <>
              <header>
                <h3>{getReviewStatusLabel(selectedReview.status)}</h3>
                <small>{formatPhone(selectedReview.customer_phone)}</small>
              </header>

              <div className="ai-review-block">
                <strong>Customer question</strong>
                <p>{selectedReview.question}</p>
              </div>

              <div className="ai-review-block">
                <strong>AI generated answer</strong>
                <p>{selectedReview.ai_response}</p>
              </div>

              <div className="ai-review-meta-row">
                <span className={selectedReview.confidence_score < 70 ? "ai-review-confidence low" : "ai-review-confidence"}>
                  Confidence {selectedReview.confidence_score}%
                </span>
                <div className="ai-review-signals">
                  {selectedReview.trigger_signals.map((signal) => (
                    <span key={signal}>{getReviewSignalLabel(signal)}</span>
                  ))}
                </div>
              </div>

              {selectedReview.conversation_id ? (
                <div className="ai-review-block">
                  <strong>Conversation context</strong>
                  {reviewConversationQuery.isLoading ? (
                    <p className="empty-note">Loading conversation...</p>
                  ) : (reviewConversationQuery.data ?? []).length === 0 ? (
                    <p className="empty-note">No conversation history found.</p>
                  ) : (
                    <div className="ai-review-context">
                      {(reviewConversationQuery.data ?? []).slice(-12).map((message) => (
                        <div key={message.id} className={`ai-review-context-item ${message.direction}`}>
                          <p>{message.message_text}</p>
                          <small>{new Date(message.created_at).toLocaleString()}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <label>
                Correct answer
                <textarea
                  rows={5}
                  value={reviewResolutionAnswer}
                  onChange={(event) => setReviewResolutionAnswer(event.target.value)}
                  placeholder="Write the correct answer to teach AI for future similar questions."
                />
              </label>

              <div className="clone-hero-actions">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={resolveMutation.isPending || selectedReview.status === "resolved"}
                  onClick={() => resolveMutation.mutate({ addToKnowledgeBase: true })}
                >
                  Save & Add to Knowledge Base
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={resolveMutation.isPending || selectedReview.status === "resolved"}
                  onClick={() => resolveMutation.mutate({ addToKnowledgeBase: false })}
                >
                  Mark resolved
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildReviewQueueQueryOptions(token, "pending"));
}
