# AI Credit System

## Credit Costs per Action

### 1 credit
| Action | Trigger |
|---|---|
| `auto_reply` / `chatbot_reply` | AI auto-reply to an incoming WhatsApp/Web message |
| `ai_agent_flow` | Flow node executing an AI agent step |
| `flow_decision` | AI picking a branch inside a flow |
| `rag_query` / `rag_embed_query` | Knowledge base Q&A lookup |
| `kb_ingest_chunk` | Ingesting one chunk into the knowledge base |
| `ai_text_assist` | Compose-box rewrite / assist |
| `ai_lead_summary` | AI-generated contact summary card |
| `ai_intent_classify` | Intent classification inside a flow |
| `lead_scoring` | AI lead scoring |
| `summary` / `background_summary` | Conversation summary (manual or background) |
| `translation` | Message translation |
| `rewrite` | Message rewrite |
| `background_tagging` | Auto-tagging conversations |
| `rag_reindex` | Full re-index of a knowledge base source |

### 2 credits
| Action | Trigger |
|---|---|
| `campaign_personalization` | Personalizing a broadcast message with AI |

### 4 credits
| Action | Trigger |
|---|---|
| `image_analysis` / `image_analyze` | Vision analysis of an image in a conversation |

### 8 credits
| Action | Trigger |
|---|---|
| `template_generate` | AI-generating a WhatsApp template |
| `flow_draft_generate` / `flow_generation` | AI-generating or drafting a flow |
| `onboarding_autofill` | AI filling workspace onboarding fields |

---

## Monthly Quota by Plan

Token budget = credits × 8,000. OpenAI cost estimated at gpt-4o-mini rates ($0.15/1M input, $0.60/1M output) with a typical 75% input / 25% output split. USD → INR at ₹84.

| Plan | Credits / month | Token budget | OpenAI cost (USD) | OpenAI cost (INR) |
|---|---|---|---|---|
| Trial    |    150 |   1,200,000 | ~$0.32  | ~₹27   |
| Starter  |    750 |   6,000,000 | ~$1.58  | ~₹133  |
| Pro      |  2,000 |  16,000,000 | ~$4.20  | ~₹353  |
| Business |  2,500 |  20,000,000 | ~$5.25  | ~₹441  |

**How the estimate is calculated (per plan):**

```
total_tokens   = credits × 8,000
input_tokens   = total_tokens × 0.75
output_tokens  = total_tokens × 0.25

usd_cost = (input_tokens / 1,000,000 × $0.15)
         + (output_tokens / 1,000,000 × $0.60)
inr_cost = usd_cost × 84
```

**Margin vs plan price (gpt-4o-mini):**

| Plan | Monthly price (INR) | OpenAI cost (INR) | Gross margin |
|---|---|---|---|
| Trial    | free     | ~₹27  | —     |
| Starter  | ₹799/mo  | ~₹133 | ~83%  |
| Pro      | ₹1,499/mo | ~₹353 | ~76%  |
| Business | ₹2,999/mo | ~₹441 | ~85%  |

> Margin narrows at higher plans by design — power users get more tokens per rupee paid.

---

## Recharge Packs

| Credits | Price (INR) |
|---|---|
| 120 | ₹499 |
| 260 | ₹999 |
| 600 | ₹1,999 |

Prices are inclusive of 18% GST.

---

## Balance & Grace Rules

- **Grace buffer**: balance can reach **−5** before conversational actions are hard-blocked. This prevents a reply from failing mid-conversation when the balance hits zero.
- **Hard-gated actions** — blocked immediately at balance ≤ 0 (no grace):
  - `template_generate`
  - `flow_draft_generate` / `flow_generation`
  - `onboarding_autofill`
  - `kb_ingest_chunk`
  - `rag_reindex`

  Creation and indexing features are blocked immediately; only live reply actions get the grace window.

---

## Token → Credit Conversion

Each credit maps to **8,000 tokens**. The fixed per-action cost above is the minimum — if an action uses more tokens than the base budget, extra credits are deducted proportionally.

Per-action token caps:

| Action | Token cap |
|---|---|
| `rag_query`, `image_analyze`, `image_analysis` | 12,000 |
| `flow_draft_generate`, `flow_generation` | 10,000 |
| `chatbot_reply`, `auto_reply`, `ai_agent_flow`, `ai_lead_summary`, `summary` | 8,000 |
| `template_generate`, `onboarding_autofill` | 6,000 |
| `kb_ingest_chunk` | 4,000 |
| `ai_text_assist`, `ai_intent_classify` | 4,000 |
| `rag_embed_query` | 2,000 |

---

## Model Pricing (INR cost tracking only — not billed to user)

Actual OpenAI spend is tracked internally in INR for reporting. It does **not** affect credit deductions — credits are flat per action.

| Model | Input (USD / 1M tokens) | Output (USD / 1M tokens) |
|---|---|---|
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4.1-mini | $0.40 | $1.60 |
| gpt-4.1-nano | $0.10 | $0.40 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4-turbo | $10.00 | $30.00 |

USD → INR conversion uses `USD_TO_INR` env variable.

---

## Source Files

| Concern | File |
|---|---|
| Action costs, plan quotas, grace limit, hard-gated list, `chargeUser()` | `apps/api/src/services/ai-token-service.ts` |
| Recharge pack prices, order creation | `apps/api/src/services/workspace-billing-center-service.ts` |
| Model pricing, USD/INR cost estimation | `apps/api/src/services/usage-cost-service.ts` |
| Credit billing tests | `apps/api/src/services/ai-credit-billing.test.ts` |
