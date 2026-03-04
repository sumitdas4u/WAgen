# Complete Token Usage Funnel - System Architecture

## 🎯 Token Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER MESSAGE RECEIVED                                 │
│                    (Message Router Entry Point)                              │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Parse Message Type   │
                    │  (No tokens used)     │
                    └───────────┬───────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
    ┌─────▼──────┐    ┌────────▼────────┐    ┌──────▼──────┐
    │  Autofill   │    │  Test Chat      │    │  Auto-Reply │
    │  REQUEST    │    │  REQUEST        │    │  REQUEST    │
    │  (Optional) │    │  (Optional)     │    │  (Check if  │
    └─────┬──────┘    └────────┬────────┘    │   enabled)  │
          │                    │              └──────┬──────┘
          │                    │                     │
    ┌─────▼─────────────────────────────────────────▼─────┐
    │           EMBEDDING GENERATION STAGE               │
    │      (text-embedding-3-small Model)                │
    │                                                    │
    │  Input: User message text                          │
    │  Output: 1536-dim vector embedding                │
    │  Token Cost: ~150-300 tokens per message          │
    │  Cost per 1M: $0.02                               │
    │  Function: embed() / embedMany()                  │
    └──────────┬──────────────────────────────────────────┘
               │
      ┌────────▼────────┐
      │  Store Vector   │
      │  in pgvector    │
      │  (No tokens)    │
      └────────┬────────┘
               │
      ┌────────▼──────────────────────────────┐
      │   KNOWLEDGE BASE RETRIEVAL STAGE       │
      │   (Similarity Search in pgvector)      │
      │                                        │
      │  Query: Find top 5 similar chunks      │
      │  Window: 3-sentence context per chunk │
      │  Returns: 0-5 "retrieval_chunks"      │
      │  Token Cost: 0 tokens (SQL search)    │
      └────────┬──────────────────────────────┘
               │
      ┌────────▼────────────────┐
      │  Retrieved Data Ready   │
      │  (0-5 knowledge chunks) │
      └────────┬────────────────┘
               │
      ┌────────▼────────────────────────────────────────────────┐
      │         AI DECISION TREE (7-Point Check)                │
      │                                                          │
      │  1. Conversation in manual takeover?  → SKIP AI         │
      │  2. AI paused for user?               → SKIP AI         │
      │  3. External bot detected?            → SKIP AI         │
      │  4. User AI access enabled?           → SKIP AI         │
      │  5. Auto-reply cooldown active?       → SKIP AI         │
      │  6. Message within retention window?  → SKIP AI         │
      │  7. Knowledge base has data?          → CONTINUE        │
      │                                                          │
      │  (All checks: 0 tokens to execute)                      │
      └────────┬─────────────────────────────────────────────────┘
               │
      ┌────────▼────────────┐         ┌──────────────────────┐
      │  Skip AI            │         │  Proceed with AI     │
      │  Return cached      │         │    Generation        │
      │  template response  │         │                      │
      │  (0 tokens)         │         │  Build prompt...     │
      └────────┬────────────┘         └──────────┬───────────┘
               │                                 │
               │         ┌───────────────────────┘
               │         │
      ┌────────▼─────────▼──────────────────────────────────┐
      │        PROMPT CONSTRUCTION STAGE                    │
      │      (gpt-4o-mini Model - Chat Completion)         │
      │                                                    │
      │  System Role: ~150 tokens (fixed)                 │
      │  + Context windows: 3000-5000 tokens              │
      │  + Retrieved chunks: 500-2000 tokens              │
      │  + Message history: 1000-3000 tokens              │
      │  + User message: 50-500 tokens                    │
      │  ────────────────────────────────────────────     │
      │  TOTAL PROMPT: (~4700 - 10650 tokens)            │
      │                                                    │
      │  TL;DR: AVG ~6000-7000 input tokens              │
      │  Cost per 1M: $0.15 per 1M tokens                │
      │  Cost per 1000: $0.0009                          │
      └──────────┬──────────────────────────────────────────┘
                 │
      ┌──────────▼────────────────────────────────────────┐
      │    CALL OPENAI API: generateReply()               │
      │                                                   │
      │  POST /v1/chat/completions                       │
      │  Model: gpt-4o-mini                              │
      │  Temperature: 0.7                                │
      │  Max Tokens: 512 (for response)                 │
      │                                                   │
      │  INPUT TOKENS CHARGED: ~6000-7000               │
      │  WAIT FOR RESPONSE...                           │
      │                                                   │
      │  OUTPUT TOKENS: ~60-150 tokens (typical)        │
      │                                                   │
      │  Cost per 1M output: $0.60 per 1M tokens        │
      │  Cost per 1000: $0.006                          │
      └──────────┬───────────────────────────────────────┘
                 │
      ┌──────────▼──────────────────────────────────┐
      │  RESPONSE RETURNED FROM OPENAI               │
      │                                              │
      │  - AI Response Text                         │
      │  - Input Tokens Used                        │
      │  - Output Tokens Used                       │
      │  - Total Tokens Used (per API)              │
      └──────────┬──────────────────────────────────┘
                 │
      ┌──────────▼──────────────────────────────────┐
      │   TOKEN LOGGING STAGE                        │
      │   (conversation_messages table)             │
      │                                              │
      │  INSERT:                                    │
      │  - prompt_tokens: 6500                      │
      │  - completion_tokens: 85                    │
      │  - total_tokens: 6585                       │
      │  - token_cost_usd: 0.00393                 │
      │  - model: "gpt-4o-mini"                    │
      │  - created_at: NOW()                        │
      │                                              │
      │  Database: PostgreSQL (instant)             │
      │  Token Cost: 0 (just storage)              │
      └──────────┬──────────────────────────────────┘
                 │
      ┌──────────▼─────────────────────────────────┐
      │  FORMAT & SEND RESPONSE TO USER             │
      │                                             │
      │  - Apply AI Review Logic                   │
      │  - Check for fallback patterns             │
      │  - Queue to Learning Center if needed      │
      │  - Send via WebSocket/HTTP                │
      │                                             │
      │  Token Cost: 0 (transmission)              │
      └──────────┬─────────────────────────────────┘
                 │
		 │
      ┌──────────▼──────────────────────────────────┐
      │         RESPONSE RECEIVED BY USER            │
      │                                              │
      │  Total Tokens Consumed:                    │
      │  ✓ Embedding: 200 tokens ($0.000004)       │
      │  ✓ Input: 6500 tokens ($0.000975)          │
      │  ✓ Output: 85 tokens ($0.000051)           │
      │  ────────────────────────────────────────  │
      │  TOTAL: 6785 tokens ($0.00103)             │
      │  IN RUPEES: ₹0.085                         │
      └──────────────────────────────────────────────┘
```

---

## 📊 Token Consumption by Stage

### Stage 1: Message Embedding (If AI is Called)
```
INPUT:  "What is your pizza pricing?"  (5 words)
        └─ ~50 tokens

OUTPUT: 1536-dimensional vector
        └─ Embedded representation

DATABASE COST: $0.02 per 1M tokens
CALC: 50 tokens × ($0.02 / 1,000,000) = $0.000001

TYPICAL RANGE: 100-300 tokens per message
```

### Stage 2: Knowledge Base Retrieval
```
QUERY:  pgvector similarity search
        SELECT * FROM knowledge_chunks
        WHERE embedding <-> user_embedding < threshold
        LIMIT 5

RESULT: 0-5 chunks retrieved (~500-2000 tokens total if converted)
        └─ User doesn't pay separately for retrieval
        └─ Only charged for final AI input prompt

DATABASE COST: $0 (PostgreSQL compute, included in hosting)
```

### Stage 3: AI Prompt Construction
```
┌─ System Prompt
│  └─ "You are a helpful customer service bot..."  (~150 tokens)
│
├─ Context Window
│  └─ Your company info, policies (~2000-3000 tokens)
│
├─ Retrieved Knowledge Chunks
│  └─ Top 5 similar Q&A from KB (~500-1500 tokens)
│
├─ Conversation History
│  └─ Last 3-5 messages (~1000-2000 tokens)
│
└─ User's New Message
   └─ "What is your pizza pricing?" (~50-100 tokens)

TOTAL PROMPT TOKENS: ~4700-7650 tokens

TYPICAL AVERAGE: ~6000-7000 tokens

OPENAI COST: $0.15 per 1M tokens
CALC: 6500 tokens × ($0.15 / 1,000,000) = $0.000975
```

### Stage 4: AI Response Generation
```
OUTPUT TOKENS: Typical range 50-200 tokens

EXAMPLES:
- Short answer (yes/no)      → 10-30 tokens
- Medium answer (1-2 lines)  → 30-80 tokens
- Long answer (3+ lines)     → 80-200+ tokens

OPENAI COST: $0.60 per 1M output tokens
CALC: 100 tokens × ($0.60 / 1,000,000) = $0.00006

TYPICAL: $0.00003 - $0.00012 per response
```

### Stage 5: Token Logging
```
INSERT INTO conversation_messages (
  prompt_tokens,        -- 6500
  completion_tokens,    -- 85
  total_tokens,        -- 6585
  token_cost_usd,      -- 0.00393
  model,               -- "gpt-4o-mini"
  created_at           -- NOW()
)

DATABASE COST: $0 (just storage in PostgreSQL)
```

---

## 🔀 Complete End-to-End Flow with Token Counts

### Real Example: "What is your pizza pricing?"

```
STEP 1: User sends message
        Message: "What is your pizza pricing?"
        Token Cost: 0 (user input, no processing yet)

STEP 2: Embedding Generation
        embed("What is your pizza pricing?")
        Tokens Used: ~50 tokens
        Cost: $0.000001

STEP 3: Similarity Search (pgvector)
        SELECT TOP 5 similar chunks
        Retrieved: ["pricing.md", "faq.md", "menu.md"]
        Token Cost: 0 (database search)

STEP 4: AI Decision Check (7 checks)
        ✓ Not in manual takeover
        ✓ AI not paused
        ✓ Not external bot
        ✓ User AI enabled
        ✓ Cooldown not active
        ✓ Not retention window
        ✓ Knowledge available
        Token Cost: 0 (logic check)

STEP 5: Build Prompt
        System: "You are helpful..." (150 tokens)
        Context: Company info (2500 tokens)
        Knowledge: Top 5 chunks (800 tokens)
        History: Last 3 messages (1200 tokens)
        Message: Question (50 tokens)
        ────────────────────────────────
        Total Input: 4700 tokens
        Cost: $0.000705

STEP 6: Call OpenAI API
        Model: gpt-4o-mini
        Prompt Tokens: 4700
        Input Cost: $0.000705

        WAIT FOR RESPONSE...

        Generated: "We have 3 pricing tiers..."
        Completion Tokens: 87
        Output Cost: $0.000052

STEP 7: Log to Database
        INSERT conversation_messages
        prompt_tokens: 4700
        completion_tokens: 87
        total_tokens: 4787
        token_cost_usd: 0.00376

        Cost: $0 (database storage)

STEP 8: Return to User
        Response: "We have 3 pricing tiers:..."

        ┌─────────────────────────────────────┐
        │ TOTAL TOKENS CONSUMED: 4837         │
        │ - Embedding: 50 tokens              │
        │ - Input: 4700 tokens                │
        │ - Output: 87 tokens                 │
        │                                     │
        │ TOTAL COST: $0.00376 USD            │
        │ IN RUPEES: ₹0.315                   │
        │                                     │
        │ Cost per 1000 tokens: $0.000778     │
        └─────────────────────────────────────┘
```

---

## 🎮 Different User Paths & Token Costs

### Path 1: Autofill Request (User Typing)
```
┌─────────────────────────────────────┐
│  User types partial message         │
│  "What is your p..."                │
└─────────────────────────────────────┘
                 │
        ┌────────▼────────┐
        │  Trigger Check  │ (No tokens)
        │  Min 3 chars?   │
        └────────┬────────┘
                 │
    ┌────────────▼──────────────┐
    │  generateJson()           │
    │  Prompt: ~2000 tokens     │
    │  Output: ~50 tokens       │
    │  Total: ~2050 tokens      │
    │  Cost: $0.00123 USD       │
    │  Function: Suggest next   │
    │           words           │
    └──────────────────────────┘
```

### Path 2: Test Chat (Developer Testing)
```
┌─────────────────────────────────────┐
│  Developer: "test chat" mode        │
│  Sends: "What is your return?"      │
└─────────────────────────────────────┘
                 │
    ┌────────────▼───────────────────┐
    │  Full Message Processing       │
    │  1. Embedding: ~50 tokens      │
    │  2. Knowledge Search: 0 tokens │
    │  3. AI Prompt: ~5500 tokens    │
    │  4. AI Response: ~100 tokens   │
    │  ──────────────────────────    │
    │  Total: ~5650 tokens           │
    │  Cost: $0.00339 USD            │
    │  In Rupees: ₹0.28              │
    │                                │
    │  Logged in DB for auditing     │
    └──────────────────────────────┘
```

### Path 3: Auto-Reply (System Generated)
```
┌──────────────────────────────────────┐
│  Customer: "I want to order pizza"   │
│  (In WhatsApp/SMS channel)           │
└──────────────────────────────────────┘
                 │
    ┌────────────▼────────────────────┐
    │  Full AI Pipeline               │
    │  1. Embedding: ~60 tokens       │
    │  2. Knowledge: 0 tokens         │
    │  3. Prompt: ~6000 tokens        │
    │  4. Response: ~120 tokens       │
    │  5. Review check: 0 tokens      │
    │  6. Learning center: 0 tokens   │
    │  ──────────────────────────    │
    │  Total: ~6180 tokens            │
    │  Cost: $0.00373 USD             │
    │  In Rupees: ₹0.31               │
    │                                 │
    │  → If fallback detected:        │
    │    Queue to Learning Center     │
    │    (0 additional tokens)        │
    └────────────────────────────────┘
```

---

## 💰 Cost Breakdown Matrix

### By Model

| Model | Purpose | Input Cost | Output Cost | Typical Use |
|-------|---------|-----------|-----------|------------|
| **gpt-4o-mini** | Main responses | $0.15/1M | $0.60/1M | Auto-reply, chat |
| **text-embedding-3-small** | Vector embeddings | $0.02/1M | - | Knowledge retrieval |

### By Operation Type

| Operation | Input Tokens | Output Tokens | Total Cost | USD Cost | INR Cost |
|-----------|-------------|--------------|-----------|----------|----------|
| **Simple Answer** | 4000 | 50 | 4050 | $0.0024 | ₹0.20 |
| **Medium Answer** | 5500 | 90 | 5590 | $0.0036 | ₹0.30 |
| **Complex Answer** | 7000 | 150 | 7150 | $0.0049 | ₹0.40 |
| **Autofill Only** | 2000 | 50 | 2050 | $0.0012 | ₹0.10 |
| **Embedding Only** | 50 | - | 50 | $0.000001 | ₹0.00008 |

### Monthly Cost Estimates

#### Scenario 1: Low Volume (100 conversations/day)
```
100 conversations × $0.005 avg = $0.50/day
= $15/month
= ₹1,247/month
```

#### Scenario 2: Medium Volume (1000 conversations/day)
```
1000 × $0.005 avg = $5/day
= $150/month
= ₹12,470/month
```

#### Scenario 3: High Volume (10,000 conversations/day)
```
10,000 × $0.005 avg = $50/day
= $1,500/month
= ₹124,700/month
```

---

## 🔄 What Happens at Each AI Decision Point

### Check 1: Manual Takeover?
```
IF conversation.manual_takeover = true THEN
  └─ SKIP AI
  └─ Cost: 0 tokens
  └─ Return preset response
```

### Check 2: AI Paused?
```
IF user.ai_paused = true THEN
  └─ SKIP AI
  └─ Cost: 0 tokens
  └─ Use fallback template
```

### Check 3: External Bot?
```
IF external_bot_detected THEN
  └─ SKIP AI
  └─ Cost: 0 tokens
  └─ Mark conversation as paused
```

### Check 4: User AI Enabled?
```
IF user.ai_enabled = false THEN
  └─ SKIP AI
  └─ Cost: 0 tokens
  └─ Return error message
```

### Check 5: Cooldown Active?
```
IF last_ai_call < (NOW - 30_seconds) THEN
  └─ SKIP AI (rate limiting)
  └─ Cost: 0 tokens
  └─ Prevent repeated calls
```

### Check 6: Retention Window?
```
IF created_at < (NOW - 90_days) THEN
  └─ SKIP AI (old messages)
  └─ Cost: 0 tokens
  └─ Don't process archived messages
```

### Check 7: Knowledge Available?
```
IF retrieval_chunks > 0 OR user_query_clear THEN
  └─ PROCEED WITH AI
  └─ Cost: Full pipeline token cost
  └─ Build prompt with relevant context
```

---

## 📈 Token Usage Timeline

### Per Second (1000 conversations/day)
```
86,400 seconds in day
1000 conversations ÷ 86,400 = ~0.012 conversations/second
= ~60 tokens/second (average)
```

### Per Hour (1000 conversations/day)
```
1000 ÷ 24 = ~42 conversations/hour
= ~210,000 tokens/hour (average)
= ~$0.126/hour (at $0.005 avg per conversation)
```

### Per Day (1000 conversations/day)
```
1000 conversations × ~5000 tokens = 5,000,000 tokens/day
= 5M tokens/day × ($0.15 input + $0.60 output factor)
= ~$5/day average
```

### Per Month (1000 conversations/day)
```
30 days × $5/day = $150/month
= ₹12,470/month
```

---

## 🎯 Optimization Opportunities

### 1. Reduce Input Tokens
```
Current: 6000-7000 input tokens per response
├─ System prompt: 150 tokens
├─ Context window: 2000-3000 tokens
├─ Knowledge chunks: 500-1500 tokens
├─ History: 1000-2000 tokens
└─ User message: 50-500 tokens

Optimization: Reduce context window
Cost reduction: 20-30% savings possible
═════════════════════════════════════════════
New cost per response: $0.0028 (from $0.0035)
Monthly savings (1000 conv/day): $21/month = ₹1,747
```

### 2. Cache Common Responses
```
If user asks "What is your address?" 100 times/day:
├─ Current: 100 × 5650 tokens = 565,000 tokens
├─ With cache: 1 × 5650 + 99 × 0 = 5,650 tokens
└─ Savings: 99% reduction on duplicate queries

Monthly savings (10 common queries):
= $10/month = ₹830
```

### 3: Smart Embedding Batching
```
Current: Embed individually
├─ 1000 conversations × 50 tokens each = 50,000 tokens

Optimized: Batch 10 messages, embed once per batch
├─ 1000 ÷ 10 = 100 batches
├─ 100 × 50 tokens = 5,000 tokens
└─ Savings: 90% on embedding operations

Monthly savings: $0.50/month = ₹42
```

### 4: Adaptive Context Window
```
Current: Full context always

Optimized:
├─ Simple queries: 2000 tokens context (save 30%)
├─ Complex queries: 5000 tokens context (full)
└─ Average savings: 15% per response

Cost reduction: $0.00025 per response
Monthly (1000 conv/day): $7.50/month = ₹622
```

---

## 📊 Token Counting Implementation

### In Database Schema
```sql
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  direction VARCHAR(10) NOT NULL,  -- 'inbound' or 'outbound'
  message_text TEXT NOT NULL,

  -- AI MODEL USED
  model VARCHAR(50),              -- 'gpt-4o-mini', null if not AI

  -- TOKEN COUNTS
  prompt_tokens INTEGER,          -- Input tokens (only if AI)
  completion_tokens INTEGER,      -- Output tokens (only if AI)
  total_tokens INTEGER,           -- Sum of above

  -- COST TRACKING
  token_cost_usd NUMERIC(10,8),  -- Exact cost in USD
  token_cost_inr NUMERIC(10,2),  -- Estimated INR equivalent

  -- METADATA
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Cost Calculation Function
```sql
CREATE OR REPLACE FUNCTION calculate_token_cost(
  model_name VARCHAR,
  input_tokens INTEGER,
  output_tokens INTEGER
) RETURNS NUMERIC AS $$
BEGIN
  CASE model_name
    WHEN 'gpt-4o-mini' THEN
      RETURN (input_tokens * 0.15 + output_tokens * 0.60) / 1000000;
    WHEN 'text-embedding-3-small' THEN
      RETURN (input_tokens * 0.02) / 1000000;
    ELSE
      RETURN 0;
  END CASE;
END;
$$ LANGUAGE plpgsql;
```

---

## 🏆 Summary: Complete Token Funnel

```
┌─────────────────────────────────────────────────────────────┐
│  INPUT: User Message (0 tokens - user's text)              │
└─────────┬───────────────────────────────────────────────────┘
          │
    ┌─────▼─────────────────────────────────────┐
    │  EMBEDDING STAGE: 50-300 tokens            │
    │  Cost: $0.000001 - $0.000006              │
    └─────┬───────────────────────────────────────┘
          │
    ┌─────▼─────────────────────────────────────┐
    │  KNOWLEDGE RETRIEVAL: 0 tokens             │
    │  Cost: $0 (database search)               │
    └─────┬───────────────────────────────────────┘
          │
    ┌─────▼─────────────────────────────────────┐
    │  AI DECISION CHECK: 0 tokens               │
    │  Cost: $0 (logic check)                   │
    └─────┬────────────────────────────────────────┘
          │
    ┌─────▼─────────────────────────────────────┐
    │  IF AI NEEDED:                             │
    │  ├─ Build Prompt: 4700-7000 tokens        │
    │  ├─ Call OpenAI: 4700-7000 input tokens   │
    │  ├─ Cost: $0.000975 (approx)              │
    │  └─ Receive Response: 50-200 output       │
    │     └─ Cost: $0.000051                    │
    │                                            │
    │  IF SKIPPED:                              │
    │  └─ Use Template: 0 tokens, 0 cost        │
    └─────┬────────────────────────────────────────┘
          │
    ┌─────▼─────────────────────────────────────┐
    │  LOG TO DATABASE: 0 tokens                │
    │  Cost: $0 (just storage)                  │
    │  Includes: prompt_tokens, completion_     │
    │            tokens, total_tokens,          │
    │            token_cost_usd                 │
    └─────┬────────────────────────────────────────┘
          │
    ┌─────▼─────────────────────────────────────┐
    │  OUTPUT: Response to User                 │
    │                                            │
    │  TOTAL TOKENS: 4837 (typical)             │
    │  TOTAL COST: $0.00376 USD = ₹0.315       │
    │                                            │
    │  ✓ Embedding: 50 tokens                  │
    │  ✓ Input: 4700 tokens                    │
    │  ✓ Output: 87 tokens                     │
    │  ────────────────────────────────────    │
    │  = 4837 tokens total                     │
    └─────────────────────────────────────────────┘
```

---

## 🎓 Key Takeaways

1. **Not All Requests Use AI Tokens** - 7-point decision tree can skip AI entirely (0 tokens)

2. **Embedding is Cheap** - Only 50-300 tokens per message, cost < $0.000001

3. **Input Dominates Cost** - 95% of token cost is from AI input prompt (~6000 tokens)

4. **Database Logging is Free** - No additional tokens charged for storing token counts

5. **Typical Cost Per Response** - $0.003-0.005 USD = ₹0.25-0.40

6. **Scaling is Predictable** - Cost scales linearly with conversation volume

7. **Optimization Potential** - 20-30% cost reduction possible through prompt optimization

8. **Monthly Budget** (1000 conv/day) - ~$150/month = ₹12,470/month

---

**Complete Token Usage Funnel documented and visualized.**
**Ready for production token tracking and cost monitoring.**
