# Subscription Plan & ROI (1 credit = 1 conversation / 24h)

## What “1 conversation” means (from the codebase)

**1 conversation = one total chat with one user within 24 hours.**  
All messages with that same user in that 24h window count as a single conversation and use **1 credit total**.

### Where this is implemented

- **Config:** `CONVERSATION_WINDOW_HOURS` (default **24**) in `apps/api/src/config/env.ts`.
- **Table:** `conversation_sessions` in `infra/migrations/0005_workspace_billing_credits.sql`: one row per (workspace, customer) session with `last_message_time` and `credit_deducted`.
- **Logic:** `evaluateConversationCredit()` in `apps/api/src/services/workspace-billing-service.ts`:
  - Finds the latest session for `(workspace_id, customer_phone)` (i.e. one user).
  - If `current_time - last_message_time < 24h` → **same conversation** → only `last_message_time` is updated, **no credit deduction** (`deducted: false`).
  - If no session or last message was **≥ 24h ago** → **new conversation** → 1 credit deducted, new row in `conversation_sessions` with `credit_deducted = TRUE`.
- **Call site:** `processIncomingMessage()` in `apps/api/src/services/message-router-service.ts` calls `evaluateConversationCredit()` before each AI reply. So the first message from a user in a 24h window (or the first after 24h silence) consumes 1 credit; all further messages from that user in the same 24h do not.

So in product terms: **1 conversation = one total chat with one user in 24 hours** (any number of back-and-forth messages in that window = 1 credit).

---

## Suggested plan (single recommendation)

Use this if you want **one clear setup**: good for Indian SMBs, **profitable at 5–6 replies** on every tier, with your preferred price points.

| Plan        | Price (₹/mo) | Credits/mo | Price/credit | Margin at 6 replies | Who it’s for |
|-------------|--------------|------------|-------------|----------------------|--------------|
| **Free trial** | 0          | 200 (14 days) | —         | —                    | Try before buy |
| **Starter**   | **799**     | **300**      | ₹2.66     | **~21%**             | Small shop, single outlet |
| **Growth**    | **1,499**   | **600**      | ₹2.50     | **~16%**             | Growing business |
| **Pro**       | **2,999**   | **1,200**    | ₹2.50     | **~16%**             | High volume |

**Why this:**

- **Same prices** as your proposal (₹799 / ₹1,499 / ₹2,999); only **credits** are adjusted so every tier stays in profit at **6 replies** (Growth 700→600, Pro 1500→1200).
- **Starter** stays at 300 credits (already safe at 6 replies).
- **Round numbers:** 300 / 600 / 1,200 credits are easy to communicate.
- **Upgrade path:** 2× credits each step (300 → 600 → 1,200) at ~2× price.

**One-line pitch:**

- **Starter:** “300 conversations/month – ₹799.”
- **Growth:** “600 conversations/month – ₹1,499.”
- **Pro:** “1,200 conversations/month – ₹2,999.”

---

## Plan summary (reference)

- **Free trial:** 200 credits, 14 days  
- **Paid plans (legacy/reference):**

| Plan    | Price (₹) | Credits/mo | Price per credit (₹) |
|--------|-----------|------------|----------------------|
| Starter | 999       | 1,000      | 0.999                |
| Growth  | 2,999     | 5,000      | 0.60                 |
| Pro     | 7,999     | 20,000     | 0.40                 |

---

## Your cost per credit (per “conversation”)

One **credit** = one 24h chat with one user. That chat can have **many messages**; each AI reply has token (and tiny embedding) cost. So:

**Cost per credit = (avg AI replies per 24h conversation) × (cost per AI reply).**

From `TOKEN_USAGE_FUNNEL.md` and `usage-cost-service.ts` (gpt-4o-mini), **per AI reply**: ~₹0.31–₹0.40 (tokens + embedding). Adding a small server/DB share: **~₹0.35 per reply**.

| Avg messages per conversation (24h) | Your cost per credit (₹) |
|-------------------------------------|---------------------------|
| 1 reply                              | ~₹0.35                   |
| 2 replies                            | ~₹0.70                   |
| 3 replies                            | ~₹1.05                   |
| 4 replies                            | ~₹1.40                   |
| **5 replies**                        | **~₹1.75**               |
| **6 replies**                        | **~₹2.10**               |
| 10 replies                           | ~₹3.50                   |

So margin and ROI depend on **how many messages each conversation has**. Plan using an assumed average (e.g. **3–4 messages** → **~₹1.05–₹1.40 per credit**; **5–6 messages** → **~₹1.75–₹2.10 per credit**).

---

## ROI and margin by plan

Because one conversation = one 24h chat (possibly many messages), **cost per credit** depends on usage. Two scenarios:

### Scenario A: ~2 AI replies per conversation (light use)

Cost per credit ≈ 2 × ₹0.35 = **₹0.70**.

| Plan    | Price (₹) | Credits | Your cost (₹) | Margin (₹) | Margin % |
|--------|-----------|--------|----------------|------------|----------|
| Starter | 999       | 1,000  | 700            | 299        | 30%      |
| Growth  | 2,999     | 5,000  | 3,500          | -501       | loss     |
| Pro     | 7,999     | 20,000 | 14,000         | -6,001     | loss     |

At 2 replies/conversation, **only Starter** is profitable at current pricing; Growth and Pro are below cost per credit.

### Scenario B: ~3 AI replies per conversation (typical)

Cost per credit ≈ 3 × ₹0.35 = **₹1.05**.

| Plan    | Price (₹) | Credits | Your cost (₹) | Margin (₹) | Margin % |
|--------|-----------|--------|----------------|------------|----------|
| Starter | 999       | 1,000  | 1,050          | -51        | loss     |
| Growth  | 2,999     | 5,000  | 5,250          | -2,251     | loss     |
| Pro     | 7,999     | 20,000 | 21,000         | -13,001    | loss     |

At 3 replies/conversation, **price per credit is below cost** for every tier (₹0.999, ₹0.60, ₹0.40 &lt; ₹1.05). So with “1 conversation = one total chat with one user in 24h” and multiple messages per chat, **current plan prices are too low** unless average messages per conversation is very low (e.g. ~1–2).

---

## Recommended: price or cap so every tier is profitable

You need **price per credit ≥ your cost per credit**. With ~₹0.35 per AI reply:

- If you assume **~3 messages per conversation** → cost ≈ **₹1.05/credit**. Then:
  - **Starter:** need ≥ ₹1.05/credit → e.g. **₹1,099** for 1,000 credits, or 1,000 credits at ₹999 only if you assume **≤ 2.85** replies/conversation on average.
  - **Growth:** ₹0.60/credit &lt; ₹1.05 → need higher price or fewer credits (e.g. **₹2,999 for 2,500 credits** = ₹1.20/credit), or accept thin margin at low usage.
  - **Pro:** ₹0.40/credit &lt; ₹1.05 → need e.g. **₹7,999 for ~7,000 credits** (₹1.14/credit) or **₹10,999 for 10,000 credits** (₹1.10/credit).

**Options:**

1. **Raise prices or reduce credits** so that (price ÷ credits) ≥ **₹1.05–1.20** per credit (for ~3 replies/conversation).  
2. **Track “messages per conversation”** in the product; if real average is &lt; 2, current pricing can stay and margin improves.  
3. **Cap messages per conversation** (e.g. first N replies per 24h per user = 1 credit; beyond N = extra credit or no AI) so cost per credit is bounded; then set price per credit above that bound.

---

## Token / server cost sanity check

- **Per AI reply (gpt-4o-mini):** ~4,700 input + ~90 output → **~₹0.31** (TOKEN_USAGE_FUNNEL); with embedding + server, use **~₹0.35**.  
- **Per credit:** **₹0.35 × (avg AI replies per 24h conversation)**.  
- **USD_TO_INR** in `apps/api/src/config/env.ts` (default 83) used in `usage-cost-service.ts` for INR estimates.

---

## Free trial (200 credits, 14 days)

- **Your cost** if they use all 200 credits: 200 × (avg replies per conversation × ₹0.35).  
  - At 3 replies/conversation: 200 × ₹1.05 = **₹210** per trial user.  
- Trial logic is unchanged: 1 credit = 1 conversation (one chat with one user in 24h); trial just grants 200 credits once.

---

## Pricing for 5–6 replies per conversation (recommended baseline)

If you plan for **at least 5–6 AI replies per conversation** (engaged chats), your cost per credit is:

- **5 replies:** 5 × ₹0.35 = **₹1.75/credit**
- **6 replies:** 6 × ₹0.35 = **₹2.10/credit**

To stay profitable with **~20% margin** at 6 replies, **price per credit** should be **≥ ₹2.65** (₹2.10 ÷ 0.8). Using **₹2.65–2.75/credit** keeps margin healthy even at 6 replies.

### Recommended plans (5–6 replies assumed)

| Plan | Price (₹/mo) | Credits/mo | Price/credit (₹) | Your cost* (₹) | Margin (6 replies) | Who it’s for |
|------|--------------|------------|------------------|----------------|---------------------|---------------|
| **Free trial** | 0 | 200 | — | ~420 | — | Try for 14 days |
| **Starter** | **999** | 400 | 2.50 | 840 | **~16%** | Small shop, single outlet |
| **Growth** | **2,499** | 1,000 | 2.50 | 2,100 | **~16%** | Growing business |
| **Pro** | **6,999** | 2,800 | 2.50 | 5,880 | **~16%** | High volume |

\* Est. cost = credits × ₹2.10 (6 replies per conversation).

### Alternative (higher margin at 6 replies)

If you want **~20% margin** at 6 replies, use a higher price per credit:

| Plan | Price (₹/mo) | Credits/mo | Price/credit (₹) | Margin (6 replies) |
|------|--------------|------------|-------------------|---------------------|
| **Starter** | **1,099** | 400 | 2.75 | **~24%** |
| **Growth** | **2,699** | 1,000 | 2.70 | **~22%** |
| **Pro** | **7,499** | 2,800 | 2.68 | **~22%** |

### Why plan for 5–6 replies

- **Safe for you:** Even if every conversation has 6 AI replies, you stay in profit.
- **No surprise loss:** Heavy users (long threads) don’t push cost above revenue.
- **Simple to explain:** “1 conversation = one chat with one customer in 24 hours” stays the same; you’ve just priced for engaged conversations.

---

## Your proposed plans

| Plan    | Price (₹/mo) | Credits/mo | Price/credit (₹) |
|--------|---------------|------------|-------------------|
| Starter | **799**       | 300        | 2.66              |
| Growth  | **1,499**     | 700        | 2.14              |
| Pro     | **2,999**     | 1,500      | 2.00              |

### Margin at 5 vs 6 replies per conversation

Cost per credit: **5 replies** = ₹1.75, **6 replies** = ₹2.10.

| Plan   | Price (₹) | Credits | Cost (5 rep) | Margin (5 rep) | Cost (6 rep) | Margin (6 rep) |
|--------|------------|--------|---------------|----------------|--------------|----------------|
| Starter | 799       | 300    | 525           | **34%**        | 630          | **21%**        |
| Growth  | 1,499     | 700    | 1,225         | **18%**        | 1,470        | **2%**         |
| Pro     | 2,999     | 1,500  | 2,625         | **12%**        | 3,150        | **−5%** (loss) |

**Summary:**

- **At 5 replies:** All three tiers are profitable (Starter 34%, Growth 18%, Pro 12%).
- **At 6 replies:** Starter is fine (~21%); Growth is thin (~2%); Pro is loss-making (~−5%).

**If you ship this as-is:** It works if most conversations stay around **≤5 replies**. If usage drifts to **6+ replies**, Growth and Pro will be at or below cost.

**Optional tweaks to stay safe at 6 replies:**

- **Growth:** ₹1,499 for **650 credits** (₹2.31/credit) → still thin at 6 replies; or raise to **₹1,599** for 700 credits (₹2.29/credit) → ~9% margin at 6 replies.
- **Pro:** Either **₹3,199** for 1,500 credits (₹2.13/credit) → ~1% at 6 replies, or keep ₹2,999 and give **1,400 credits** (₹2.14/credit) → ~2% at 6 replies.

---

## Indian SMB plan (3 replies vs 5–6 replies)

- **If you assume ~3 replies** (lighter use): price per credit ₹1.25–1.40 is enough (e.g. **₹799** for 600 credits, **₹1,999** for 1,500, **₹4,999** for 4,000).
- **If you assume 5–6 replies** (recommended): use the **5–6 reply** table above — e.g. **₹999** (400 cr), **₹2,499** (1,000 cr), **₹6,999** (2,800 cr) for ~16% margin; or the alternative column for ~22% margin.

### Optional Micro (5–6 replies)

| Plan | Price (₹/mo) | Credits/mo | Price/credit (₹) | Who it’s for |
|------|--------------|------------|-------------------|---------------|
| **Micro** | **599** | 220 | 2.72 | Very light use, testing |

### GST and display

- **GST:** 18% (from `BILLING_GST_RATE_PERCENT`). Show “+ GST” or “GST inclusive” as per your policy.
- **Billing:** Monthly; optional **annual** at 2 months free to improve retention.

### One-line positioning (5–6 reply pricing)

- **Starter:** “400 conversations/month – ₹999.”
- **Growth:** “1,000 conversations – ₹2,499.”
- **Pro:** “2,800 conversations – ₹6,999.”

---

## Summary

- **1 conversation** = one total chat with one user in 24 hours (code: `conversation_sessions`, `CONVERSATION_WINDOW_HOURS=24`, `evaluateConversationCredit()`).  
- **Cost per credit** = (avg AI replies per 24h conversation) × ~₹0.35. At **5–6 replies**, cost ≈ **₹1.75–₹2.10/credit**.  
- **Suggested plan (use this):** Free trial 200 credits (14 days). **Starter ₹799** (300 cr), **Growth ₹1,499** (600 cr), **Pro ₹2,999** (1,200 cr). Same prices as your proposal; credits set so every tier is **~16–21% margin at 6 replies**.  
- **Your earlier proposal** (700 / 1,500 credits for Growth/Pro) is fine at 5 replies; at 6 replies use the suggested credits above so Growth and Pro stay profitable.
