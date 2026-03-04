# Token Optimization Plan - Complete Strategy

## Executive Summary

**Current State:**
- Average cost per response: $0.00376 USD (₹0.31)
- Monthly cost (1000 conv/day): ~$150/month (₹12,470/month)
- Typical token consumption: 4837 tokens per response

**Target Optimization:**
- **Tier 1 (Quick Wins):** 15-20% reduction ($30-40/month savings)
- **Tier 2 (Implementation):** 30-40% reduction ($60-80/month savings)
- **Tier 3 (Architecture):** 50-60% reduction ($100-150/month savings)

**Overall Potential:** **₹3,732 - ₹6,220 monthly savings** with comprehensive optimization

---

## 📊 Current Token Consumption Breakdown

```
Per Average Response (4837 tokens total):
┌────────────────────────────────────────┐
│ Embedding: 50 tokens (1%)              │
│ Input Prompt: 4700 tokens (97%)        │
│  ├─ System Prompt: 150 (3%)            │
│  ├─ Context Window: 2500 (52%)         │
│  ├─ Knowledge Chunks: 800 (17%)        │
│  ├─ Message History: 1200 (25%)        │
│  └─ User Message: 50 (1%)              │
│ Output Response: 87 tokens (2%)        │
└────────────────────────────────────────┘

Cost Breakdown:
┌────────────────────────────────────────┐
│ Input Cost: $0.000705 (19%)            │
│ Output Cost: $0.000052 (1%)            │
│ Total Cost: $0.000757 per response     │
│ × 1000 responses/day = $0.757/day      │
│ × 30 days = $22.71/month               │
└────────────────────────────────────────┘

WHERE 97% OF COST COMES FROM INPUT TOKENS
```

---

## 🎯 Optimization Tier 1: Quick Wins (15-20% Savings)

### Strategy 1.1: Smart Context Window Reduction
**Implementation Level:** LOW (Config change only)
**Expected Saving:** 20-30% on input tokens
**Time to Implement:** 1-2 hours

#### Current Implementation:
```typescript
// apps/api/src/services/openai-service.ts

const systemPrompt = `You are a helpful customer service bot...`;  // 150 tokens

const contextWindow = `
${companyInfo.fullProfile}          // 800 tokens
${companyInfo.policies}             // 400 tokens
${companyInfo.faq}                  // 800 tokens
`;  // TOTAL: 2000 tokens (ALWAYS INCLUDED)

const retrievedChunks = topChunks.map(c => c.text).join('\n');  // 800 tokens
const messageHistory = conversation.messages.slice(-5);          // 1200 tokens

const finalPrompt = `${systemPrompt}\n${contextWindow}\n${retrievedChunks}\n${messageHistory}\n${userMessage}`;
// TOTAL: ~5000 tokens EVERYTIME
```

#### Optimization Strategy:
```typescript
// ADAPTIVE CONTEXT WINDOW BASED ON QUERY COMPLEXITY

function estimateQueryComplexity(userMessage: string): 'simple' | 'medium' | 'complex' {
  const tokens = userMessage.split(' ').length;
  const questions = (userMessage.match(/\?/g) || []).length;

  // Simple: Greeting, yes/no, single question, <20 words
  if (questions <= 1 && tokens < 20 && !userMessage.includes('when')) {
    return 'simple';
  }

  // Complex: Multiple questions, conditional, detailed
  if (questions >= 2 || tokens > 50 || userMessage.includes('what if')) {
    return 'complex';
  }

  return 'medium';
}

// LOAD CONTEXT ADAPTIVELY
const queryComplexity = estimateQueryComplexity(userMessage);

let contextWindow = '';
let contextTokensBudget = 0;

switch (queryComplexity) {
  case 'simple':
    // Minimal context: Just core info, no FAQ, no full policies
    contextTokensBudget = 1000;
    contextWindow = `
${companyInfo.name} - ${companyInfo.shortDescription}
${companyInfo.contactEmail}
${companyInfo.supportPhone}
    `.trim();
    // TOKENS: ~150 (vs 2000 before)
    break;

  case 'medium':
    // Standard context: Core info + key policies
    contextTokensBudget = 2000;
    contextWindow = `
${companyInfo.shortDescription}
Services: ${companyInfo.services.join(', ')}
Hours: ${companyInfo.businessHours}
Key Policies: ${companyInfo.keyPolicies.slice(0, 3).join('; ')}
    `.trim();
    // TOKENS: ~500 (vs 2000 before)
    break;

  case 'complex':
    // Full context: Everything (original behavior)
    contextTokensBudget = 2000;
    contextWindow = buildFullContextWindow();  // 2000 tokens
    break;
}

const finalPrompt = buildPrompt({
  systemPrompt,         // 150 tokens (constant)
  contextWindow,        // 150-2000 tokens (adaptive)
  retrievedChunks,      // 800 tokens (constant)
  messageHistory,       // 1200 tokens (constant)
  userMessage           // 50 tokens (on user)
});

// RESULT:
// Simple query: 150 + 150 + 800 + 0 + 50 = 1150 tokens (77% reduction)
// Medium query: 150 + 500 + 800 + 600 + 50 = 2100 tokens (58% reduction)
// Complex query: 150 + 2000 + 800 + 1200 + 50 = 4200 tokens (16% reduction on avg)
```

**Impact Calculation:**
```
Current: 1000 responses × 4700 input tokens = 4.7M tokens/month
New distribution:
  - 40% simple (1150 tokens): 400 × 1150 = 460k tokens
  - 40% medium (2100 tokens): 400 × 2100 = 840k tokens
  - 20% complex (4200 tokens): 200 × 4200 = 840k tokens
  ────────────────────────────────────────────
  Total: 2.14M tokens/month (54% reduction)

Cost Reduction:
  Before: 4.7M × ($0.15/1M) = $0.705/month per conversation
  After: 2.14M × ($0.15/1M) = $0.321/month per conversation
  Monthly Savings (1000 conv/day): $11.52/month = ₹956
```

---

### Strategy 1.2: Compress System Prompt
**Implementation Level:** LOW (Text editing)
**Expected Saving:** 10-15% on input tokens
**Time to Implement:** 30 minutes

#### Current System Prompt (150 tokens):
```typescript
const systemPrompt = `You are a helpful and professional customer service assistant
for our pizza restaurant. Your goal is to help customers with their orders,
provide information about our menu, answer questions about delivery, handle
complaints, and ensure customer satisfaction. Always be polite, accurate,
and helpful. If you don't know something, ask the customer for clarification
or suggest they contact support.`;
```

#### Optimized System Prompt (85 tokens):
```typescript
const systemPrompt = `You are a customer service bot for a pizza restaurant.
Help with orders, menu info, delivery & complaints. Be helpful & professional.
If unsure, ask for clarification.`;
```

**Comparison:**
```
BEFORE: 150 tokens
AFTER: 85 tokens
REDUCTION: 65 tokens (43% reduction on system prompt)
MONTHLY IMPACT: 65 × 1000 = 65k tokens = $0.0098/month = ₹0.81
```

---

### Strategy 1.3: Reduce Message History Window
**Implementation Level:** LOW (Config change)
**Expected Saving:** 15-25% on input tokens
**Time to Implement:** 1 hour

#### Current Implementation:
```typescript
// Always fetch last 5 messages for context
const messageHistory = conversation.messages
  .slice(-5)  // Last 5 messages
  .map(m => `${m.direction}: ${m.text}`)
  .join('\n');

// Each message ~240 tokens on average
// 5 messages × 240 = 1200 tokens ALWAYS
```

#### Optimized Implementation:
```typescript
// ADAPTIVE MESSAGE HISTORY BASED ON CONVERSATION FLOW

function shouldIncludeHistory(vectorSimilarity: number, queryComplexity: string): boolean {
  // For high-similarity retrieval (FAQ questions), history unnecessary
  if (vectorSimilarity > 0.85) return false;

  // For simple questions, minimal history needed
  if (queryComplexity === 'simple') return false;

  return true;
}

function getMessageHistoryWindow(
  vectorSimilarity: number,
  queryComplexity: string,
  conversationLength: number
): number {
  // If high KB match: no history needed
  if (vectorSimilarity > 0.85) return 0;

  // If simple question: just last 1 message for context
  if (queryComplexity === 'simple') return 1;

  // If medium: last 2-3 messages
  if (queryComplexity === 'medium') return 2;

  // If complex/multi-turn: last 3-4 messages
  return 3;
}

const similarityScore = vectorResults[0]?.similarity ?? 0;
const historyWindow = getMessageHistoryWindow(
  similarityScore,
  queryComplexity,
  conversation.messages.length
);

const messageHistory = conversation.messages
  .slice(-historyWindow)
  .map(m => `${m.direction}: ${m.text}`)
  .join('\n');

// RESULT:
// FAQ questions (high similarity): 0 messages = 0 tokens (HUGE savings!)
// Simple questions: 1 message = 240 tokens (80% reduction from 1200)
// Medium questions: 2-3 messages = 480-720 tokens (60% reduction)
// Complex: 3 messages = 720 tokens (40% reduction)
```

**Impact Calculation:**
```
Assuming similarity distribution in typical conversations:
- 30% FAQ-like (high similarity): 0 tokens × 300 = 0 tokens
- 30% simple: 240 tokens × 300 = 72k tokens
- 25% medium: 600 tokens × 250 = 150k tokens
- 15% complex: 720 tokens × 150 = 108k tokens
─────────────────────────────────────────
CURRENT: 5 × 240 × 1000 = 1.2M tokens/month
OPTIMIZED: Total 330k tokens/month (73% reduction on history)

Monthly Savings:
  (1.2M - 330k) × ($0.15/1M) = $0.1305/month = ₹10.84
```

---

## 🎯 Optimization Tier 2: Implementation Changes (30-40% Savings)

### Strategy 2.1: Implement Response Caching
**Implementation Level:** MEDIUM (Redis/Database)
**Expected Saving:** 20-40% on total tokens
**Time to Implement:** 4-6 hours

#### Concept:
Cache responses for frequently asked questions to avoid redundant API calls.

#### Implementation:
```typescript
// apps/api/src/services/cache-service.ts

import redis from 'redis';

const cacheClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});

async function getCachedResponse(userMessage: string): Promise<string | null> {
  const messageHash = hashNormalized(normalizeText(userMessage));
  const cachedResponse = await cacheClient.get(`response:${messageHash}`);

  if (cachedResponse) {
    console.log(`[Cache] HIT: question="${userMessage.substring(0, 50)}..."`);
    return JSON.parse(cachedResponse).response;
  }

  return null;
}

async function cacheResponse(
  userMessage: string,
  aiResponse: string,
  confidence: number
): Promise<void> {
  // Only cache high-confidence responses
  if (confidence < 75) return;

  const messageHash = hashNormalized(normalizeText(userMessage));
  const ttl = 7 * 24 * 60 * 60;  // 7 days

  await cacheClient.setex(
    `response:${messageHash}`,
    ttl,
    JSON.stringify({ response: aiResponse, timestamp: Date.now() })
  );

  console.log(`[Cache] STORED: question="${userMessage.substring(0, 50)}..."`);
}

// Integration in message-router
async function processMessage(message: string) {
  // TRY CACHE FIRST
  const cachedResponse = await getCachedResponse(message);
  if (cachedResponse) {
    // COST: 0 tokens
    return {
      response: cachedResponse,
      source: 'cache',
      tokens: 0,
      cost: 0
    };
  }

  // NOT IN CACHE: Full AI pipeline
  const embedding = await embed(message);  // 50 tokens
  const chunks = await retrieval(embedding);
  const aiResponse = await generateReply({...});  // ~4700 input + 87 output

  // CACHE FOR FUTURE
  await cacheResponse(message, aiResponse, confidenceScore);

  return {
    response: aiResponse,
    source: 'ai',
    tokens: 4837,
    cost: 0.00376
  };
}
```

#### Cache Hit Rate Analysis:
```
Common patterns in customer service:
- FAQ questions: "What are your hours?" → SAME QUESTION asked 50+ times/day
- Order status: "Where is my order?" → Similar questions, similar answers
- Pricing: "How much for a large pepperoni?" → Repetitive patterns
- Delivery: "Do you deliver to my area?" → Frequently repeated

Realistic Cache Hit Rates:
────────────────────────────────────────
Small business (100 conv/day):
  - Cache hit rate: 20-30%
  - Savings: 20-30 conversations × 4837 tokens = 96k-145k tokens saved

Medium business (1000 conv/day):
  - Cache hit rate: 30-35% (more volume = more repetition)
  - Savings: 300-350 × 4837 = 1.45M-1.69M tokens/month

Large business (10k conv/day):
  - Cache hit rate: 40-50% (much repetition)
  - Savings: 4000-5000 × 4837 = 19.3M-24.2M tokens/month
```

#### Cost Impact (1000 conversations/day):
```
WITH CACHE (35% hit rate):
- Cache hits: 350 × 0 tokens = 0 tokens (no cost)
- Cache misses: 650 × 4837 tokens = 3.14M tokens
- Monthly tokens: 3.14M × 30 = 94.2M tokens
- Monthly cost: 94.2M × ($0.15/1M) = $14.13

WITHOUT CACHE:
- All requests: 1000 × 4837 = 4.837M tokens
- Monthly tokens: 4.837M × 30 = 145.1M tokens
- Monthly cost: 145.1M × ($0.15/1M) = $21.77

MONTHLY SAVINGS: $21.77 - $14.13 = $7.64/month = ₹633
```

---

### Strategy 2.2: Intelligent Message Summarization
**Implementation Level:** MEDIUM (Summary generation)
**Expected Saving:** 15-25% on message history tokens
**Time to Implement:** 3-4 hours

#### Concept:
Instead of sending full conversation history, summarize old messages to reduce token count.

#### Implementation:
```typescript
// For conversations with >5 messages, summarize older ones

async function summarizeConversationHistory(
  messages: Message[],
  maxMessages: number = 5
): Promise<string> {
  // Keep last 2-3 messages verbatim (most relevant)
  const recentMessages = messages.slice(-3);

  // Summarize older messages if conversation is long
  if (messages.length > 5) {
    const olderMessages = messages.slice(0, -3);

    // Create summary with minimal tokens
    const summary = await generateSummary({
      messages: olderMessages,
      maxTokens: 200,  // Keep summary SHORT
      model: 'gpt-3.5-turbo'  // Cheaper model
    });

    const contextString = `
Previous conversation summary:
${summary}

Recent messages:
${recentMessages.map(m => `${m.direction}: ${m.text}`).join('\n')}
    `.trim();

    return contextString;
  }

  // Short conversations: Keep all messages
  return messages.map(m => `${m.direction}: ${m.text}`).join('\n');
}

// EXAMPLE:
// Before (5 messages × 240 tokens each = 1200 tokens):
// Customer: "What are your hours?"
// Bot: "We're open 11am-11pm daily"
// Customer: "Are you open on Sunday?"
// Bot: "Yes, we're open on Sundays 11am-10pm"
// Customer: "Great, can I order now?"

// After (summary + 2 recent = ~400 tokens):
// Summary: "Customer asked about business hours; confirmed Sunday operation"
// Recent:
// Bot: "Yes, we're open on Sundays 11am-10pm"
// Customer: "Great, can I order now?"

// TOKENS SAVED: 1200 - 400 = 800 tokens per response (67% reduction on history)
```

#### Cost Impact:
```
Monthly (1000 conv/day):
- Summarization cost: 1000 × 200 tokens × 0.002 = $0.40/month
  (Using cheaper gpt-3.5-turbo at $0.002 per 1M tokens)

History savings: 1000 × 800 tokens × ($0.15/1M) = $0.12/month

NET SAVINGS: $0.12 - $0.40 = break-even (slight cost, but value in quality)

Alternative: Use in-memory summarization (0 cost)
- Don't send to OpenAI, use simple extractive summary
- Extract: names, key questions, important decisions
- Cost: 0 tokens
- Savings: $0.12/month = ₹10
```

---

### Strategy 2.3: Batch Embedding Operations
**Implementation Level:** MEDIUM (Queue system)
**Expected Saving:** 15-20% on embedding tokens
**Time to Implement:** 4-5 hours

#### Concept:
Instead of embedding each message individually, batch them for efficiency.

#### Current (Inefficient):
```typescript
// EMBEDDING ONE-BY-ONE
async function processMessage(userMessage: string) {
  const embedding = await embed(userMessage);  // 50 tokens, 1 API call
  // ... rest of pipeline
}

// If 100 messages come in same second:
// 100 API calls × 50 tokens = 5000 tokens
// 100 round-trips to OpenAI (SLOW)
```

#### Optimized (Batched):
```typescript
// BATCH EMBEDDING SERVICE

class BatchEmbeddingService {
  private queue: { message: string; userId: string; resolve: Function }[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 25;
  private readonly BATCH_WINDOW = 100;  // milliseconds

  async embedMessage(userMessage: string, userId: string): Promise<number[]> {
    return new Promise((resolve) => {
      this.queue.push({ message: userMessage, userId, resolve });

      // Start batch timer if not already running
      if (!this.batchTimer && this.queue.length === 1) {
        this.batchTimer = setTimeout(() => this.processBatch(), this.BATCH_WINDOW);
      }

      // Process immediately if batch is full
      if (this.queue.length >= this.BATCH_SIZE) {
        clearTimeout(this.batchTimer!);
        this.processBatch();
      }
    });
  }

  private async processBatch() {
    const batch = this.queue.splice(0, this.BATCH_SIZE);
    if (batch.length === 0) return;

    try {
      // SINGLE API CALL for multiple messages
      const embeddings = await embedMany(
        batch.map(b => b.message),
        {
          model: 'text-embedding-3-small',
          dimensions: 1536
        }
      );

      // Resolve all promises
      embeddings.forEach((emb, idx) => {
        batch[idx].resolve(emb);
      });

      console.log(`[Batch] Embedded ${batch.length} messages in 1 API call`);
    } catch (error) {
      batch.forEach(b => b.resolve(null));
    }

    this.batchTimer = null;

    // Continue processing if queue not empty
    if (this.queue.length > 0) {
      this.batchTimer = setTimeout(() => this.processBatch(), this.BATCH_WINDOW);
    }
  }
}

const batchEmbedding = new BatchEmbeddingService();

// Usage
async function processMessage(userMessage: string, userId: string) {
  const embedding = await batchEmbedding.embedMessage(userMessage, userId);
  // ... rest of pipeline
}
```

#### Cost Impact:
```
Scenario: 1000 conversations in a peak hour

WITHOUT BATCHING:
- 1000 individual API calls × 50 tokens = 50,000 tokens
- Cost: 50k × ($0.02/1M) = $0.001/hour
- Latency: High (round-trip delay per request)

WITH BATCHING (batch size 25):
- 40 batch calls × 50 messages × 50 tokens = 100,000 tokens
  (Actually, embedMany might be slightly cheaper per token)
- Cost: 100k × ($0.02/1M) = $0.002/hour
- BENEFIT: Massive latency reduction & better throughput

ROI: Slight token increase but:
  - 40× fewer API calls (network efficiency)
  - Lower latency (100ms vs 500ms+ per individual)
  - Better for high-volume scenarios
  - Database query load reduced
```

---

## 🎯 Optimization Tier 3: Architecture Changes (50-60% Savings)

### Strategy 3.1: Hybrid Model Selection
**Implementation Level:** HARD (Model management)
**Expected Saving:** 30-50% on total cost
**Time to Implement:** 8-10 hours

#### Concept:
Use different models for different complexity levels to optimize cost/quality trade-off.

#### Implementation Plan:
```typescript
// MULTI-MODEL STRATEGY

type ModelSelection = 'gpt-4o-mini' | 'gpt-3.5-turbo' | 'custom-lightweight';

function selectOptimalModel(input: {
  queryComplexity: 'simple' | 'medium' | 'complex';
  vectorSimilarity: number;
  conversationLength: number;
  requiresMultiStep: boolean;
}): { model: ModelSelection; maxTokens: number } {

  // RULE 1: High confidence FAQ → Lightweight model
  if (input.vectorSimilarity > 0.88 && !input.requiresMultiStep) {
    return {
      model: 'gpt-3.5-turbo',  // $0.50/$2 per 1M (3.3× cheaper)
      maxTokens: 256
    };
  }

  // RULE 2: Simple questions → Cheaper model
  if (input.queryComplexity === 'simple' && input.vectorSimilarity > 0.75) {
    return {
      model: 'gpt-3.5-turbo',  // Cheaper
      maxTokens: 256
    };
  }

  // RULE 3: Complex/multi-step → Premium model
  if (input.queryComplexity === 'complex' || input.requiresMultiStep) {
    return {
      model: 'gpt-4o-mini',    // Better reasoning
      maxTokens: 512
    };
  }

  // DEFAULT: Medium complexity
  return {
    model: 'gpt-4o-mini',
    maxTokens: 512
  };
}

// Usage in message processing
async function generateAiResponse(userMessage: string, input: ResponseInput) {
  const complexity = estimateQueryComplexity(userMessage);
  const similarity = (await retrieval(embedding))[0]?.similarity ?? 0;

  const modelSelection = selectOptimalModel({
    queryComplexity: complexity,
    vectorSimilarity: similarity,
    conversationLength: conversation.messages.length,
    requiresMultiStep: false
  });

  const response = await generateReply({
    ...input,
    model: modelSelection.model,
    maxTokens: modelSelection.maxTokens
  });

  return response;
}
```

#### Cost Comparison:

```
CURRENT (Always gpt-4o-mini):
Input: $0.15/1M
Output: $0.60/1M
Typical response cost: $0.00376

WITH MODEL SELECTION (Estimated distribution):
- 30% simple FAQ (gpt-3.5-turbo):
  Input: 2000 tokens × ($0.50/1M) = $0.001
  Output: 50 tokens × ($2/1M) = $0.0001
  Subtotal: $0.0011 × 300 = $0.33

- 40% medium (gpt-4o-mini):
  Input: 4500 tokens × ($0.15/1M) = $0.000675
  Output: 85 tokens × ($0.60/1M) = $0.000051
  Subtotal: $0.000726 × 400 = $0.29

- 30% complex (gpt-4o-mini):
  Input: 6000 tokens × ($0.15/1M) = $0.0009
  Output: 120 tokens × ($0.60/1M) = $0.000072
  Subtotal: $0.000972 × 300 = $0.29

─────────────────────────────────────────────
MONTHLY (1000 conv/day):
Current: 1000 × 30 × $0.00376 = $112.80/month
Optimized: ($0.33 + $0.29 + $0.29) × 30 / (300+400+300) = $0.00244/response
           = $0.00244 × 1000 × 30 = $73.20/month

MONTHLY SAVINGS: $112.80 - $73.20 = $39.60/month = ₹3,283
```

---

### Strategy 3.2: Local Inference for Simple Tasks
**Implementation Level:** HARD (Model deployment)
**Expected Saving:** 25-35% on simple responses
**Time to Implement:** 10-12 hours

#### Concept:
Run lightweight open-source models locally for simple, low-stakes responses.

#### Implementation:
```typescript
// apps/api/src/services/local-inference-service.ts

import Ollama from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });

// Available local models:
// - mistral:latest (13B, fast, good for FAQ)
// - neural-chat:latest (13B, optimized for chat)
// - orca-mini:latest (3B, very fast, simple Q&A)

async function generateLocalResponse(userMessage: string, context: string): Promise<string | null> {
  try {
    const response = await ollama.generate({
      model: 'mistral',
      prompt: `You are a helpful customer service bot.
Context: ${context}
Customer: ${userMessage}
Assistant:`,
      stream: false,
      temperature: 0.7,
      num_predict: 256
    });

    return response.response;
  } catch (error) {
    return null;  // Fall back to OpenAI
  }
}

async function generateAiResponse(userMessage: string, input: ResponseInput) {
  const similarity = input.vectorSimilarity ?? 0;

  // TRY LOCAL MODEL FOR SIMPLE, HIGH-CONFIDENCE QUERIES
  if (similarity > 0.85 && input.queryComplexity === 'simple') {
    const contextText = `
FAQ Match Confidence: ${Math.round(similarity * 100)}%
Knowledge: ${input.retrievedChunks[0]?.text || 'N/A'}
    `.trim();

    const localResponse = await generateLocalResponse(userMessage, contextText);

    if (localResponse && !localResponse.includes('unknown') && !localResponse.includes('sorry')) {
      console.log(`[Local] Generated response (0 API tokens): "${userMessage.substring(0, 50)}..."`);

      // Log as if it cost something minimal (don't charge for local)
      await logTokenUsage({
        model: 'local-mistral',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0
      });

      return localResponse;
    }
  }

  // FALL BACK TO OPENAI FOR COMPLEX/UNCERTAIN QUERIES
  console.log(`[Local] Fallback to OpenAI: confidence too low or complex`);
  return await generateReplyOpenAI(input);  // Original OpenAI call
}
```

#### Deployment:
```bash
# Run Ollama locally (Docker recommended)
docker run -d \
  --name ollama \
  -p 11434:11434 \
  -v ollama:/root/.ollama \
  ollama/ollama

# Pull model
docker exec ollama ollama pull mistral

# Verify
curl http://localhost:11434/api/generate -d '{
  "model": "mistral",
  "prompt": "Hello",
  "stream": false
}'
```

#### Cost Impact:
```
SCENARIO: 1000 conversations/day, 35% qualify for local inference

LOCAL INFERENCE (30-35% of requests):
- 350 requests × 0 tokens = $0/month
- Quality: 95% correct for FAQ (occasional misses acceptable)

OPENAI API (65-70% of requests):
- 650 requests × 4837 tokens = 3.14M tokens/month
- Cost: 3.14M × ($0.15/1M) = $0.471/month

TOTAL: $0.471/month = ₹39/month

WITHOUT LOCAL (All OpenAI):
- 1000 requests × 4837 tokens = 4.837M tokens/month
- Cost: 4.837M × ($0.15/1M) = $0.726/month = ₹60

MONTHLY SAVINGS: $0.255/month = ₹21

INFRASTRUCTURE COST:
- Ollama server: ~2GB RAM + 5GB disk (minimal)
- On existing infra: $0-5/month additional
- AWS/GCP equivalent: $10-15/month

ROI: $21/month saved - $10/month infra cost = $11/month = ₹913 net savings
(Plus latency improvement: local inference ~100ms vs OpenAI 2000ms)
```

---

## 📈 Complete Optimization Roadmap

### Timeline & Implementation Order

```
PHASE 1: Quick Wins (Week 1-2) - 15-20% savings, ~2 hours
├─ Strategy 1.1: Adaptive context window    (1.5 hours)
├─ Strategy 1.2: Compress system prompt     (0.5 hours)
└─ Strategy 1.3: Smart message history      (1.0 hour)
   └─ Total Saving: 15-20% ($30-40/month)

PHASE 2: Smart Systems (Week 3-4) - Additional 20-25% savings, ~15 hours
├─ Strategy 2.1: Response caching          (4 hours)
├─ Strategy 2.2: Message summarization     (3 hours)
└─ Strategy 2.3: Batch embedding           (4 hours)
   └─ Total Saving: Additional 20-25% ($50-80/month)
   └─ Cumulative: 35-45% savings

PHASE 3: Architecture (Month 2) - Additional 20-30% savings, ~18 hours
├─ Strategy 3.1: Hybrid model selection    (8 hours)
└─ Strategy 3.2: Local inference           (10 hours)
   └─ Total Saving: Additional 20-30% ($80-150/month)
   └─ Cumulative: 55-75% savings

TOTAL IMPLEMENTATION: 35 hours spread over 5-6 weeks
TOTAL POTENTIAL SAVINGS: 55-75% = ₹3,400-7,400/month
```

---

## 🎯 Success Metrics & Monitoring

### Metrics to Track

```sql
-- 1. Average tokens per response
SELECT
  model,
  DATE(created_at) as date,
  AVG(total_tokens) as avg_tokens,
  AVG(token_cost_usd) as avg_cost,
  COUNT(*) as response_count
FROM conversation_messages
WHERE direction = 'outbound' AND model IS NOT NULL
GROUP BY model, DATE(created_at)
ORDER BY date DESC;

-- 2. Cache hit rate
SELECT
  DATE(accessed_at) as date,
  COUNT(CASE WHEN source = 'cache' THEN 1 END) as cache_hits,
  COUNT(CASE WHEN source = 'ai' THEN 1 END) as cache_misses,
  ROUND(100.0 * COUNT(CASE WHEN source = 'cache' THEN 1 END) /
    COUNT(*), 2) as hit_rate_percent
FROM message_responses
WHERE created_at >= DATE_TRUNC('month', NOW())
GROUP BY DATE(accessed_at)
ORDER BY date DESC;

-- 3. Cost breakdown by strategy
SELECT
  CASE
    WHEN context_size < 2000 THEN 'Optimized Context'
    WHEN retrieval_chunks > 3 THEN 'High Retrieval'
    WHEN message_history_window <= 2 THEN 'Minimal History'
    ELSE 'Standard'
  END as strategy,
  COUNT(*) as response_count,
  AVG(total_tokens) as avg_tokens,
  AVG(token_cost_usd) as avg_cost,
  SUM(token_cost_usd) as total_cost
FROM conversation_messages
WHERE direction = 'outbound' AND model IS NOT NULL
GROUP BY strategy;

-- 4. Monthly cost trend
SELECT
  DATE_TRUNC('day', created_at) as date,
  SUM(token_cost_usd) as daily_cost,
  AVG(token_cost_usd) as avg_response_cost,
  COUNT(*) as response_count
FROM conversation_messages
WHERE direction = 'outbound' AND model IS NOT NULL
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;
```

### Dashboard Views

```
┌─────────────────────────────────────────────┐
│  TOKEN OPTIMIZATION DASHBOARD               │
├─────────────────────────────────────────────┤
│                                             │
│  Today's Metrics:                          │
│  ├─ Total Tokens: 4.8M (↓15% vs yesterday) │
│  ├─ Average per Response: 4,837 → 4,100   │
│  ├─ Daily Cost: $24.50 (↓18%)              │
│  └─ Cache Hit Rate: 32% ↑                  │
│                                             │
│  This Month:                               │
│  ├─ Total Cost: $520 (vs $650 last month) │
│  ├─ Savings vs Baseline: $130 (20%)       │
│  ├─ Requests: 15,300                      │
│  └─ Avg Cost/Request: $0.034 (vs $0.042)  │
│                                             │
│  Model Distribution (This Month):          │
│  ├─ gpt-4o-mini: 60% (7,680 req)          │
│  ├─ gpt-3.5-turbo: 25% (3,825 req)        │
│  ├─ local-mistral: 15% (2,295 req)        │
│  └─ cache: 32% (4,896 cached)             │
│                                             │
│  Top Optimization Opportunities:           │
│  ├─ Increase cache hit rate (curr 32%)    │
│  ├─ Expand local inference (curr 15%)     │
│  └─ Reduce context size for FAQs (curr ok)│
│                                             │
└─────────────────────────────────────────────┘
```

---

## 💰 Final Cost Comparison

### Scenario: 1000 conversations/day

```
├─ CURRENT STATE (No Optimization)
│  └─ Monthly Cost: $150
│  └─ Monthly Cost (INR): ₹12,470
│
├─ PHASE 1 COMPLETE (Quick Wins: -20%)
│  └─ Monthly Cost: $120
│  └─ Monthly Cost (INR): ₹9,976
│  └─ SAVINGS: $30/month = ₹2,494
│
├─ PHASE 2 COMPLETE (Smart Systems: -40%)
│  └─ Monthly Cost: $90
│  └─ Monthly Cost (INR): ₹7,482
│  └─ SAVINGS: $60/month = ₹4,988
│
├─ PHASE 3 COMPLETE (Architecture: -65%)
│  └─ Monthly Cost: $52.50
│  └─ Monthly Cost (INR): ₹4,364
│  └─ SAVINGS: $97.50/month = ₹8,106
│
└─ WITH ALL OPTIMIZATIONS
   └─ Total POTENTIAL SAVINGS: $97.50/month = ₹8,100
   └─ Reduction from baseline: 65%
   └─ New monthly budget: ₹4,370 (vs ₹12,470)
```

---

## 🚀 Quick Start: Implement Phase 1 This Week

```typescript
// File: apps/api/src/services/prompt-optimizer.ts

export async function optimizePromptForQuery(
  userMessage: string,
  context: any
): Promise<{
  systemPrompt: string;
  contextWindow: string;
  messageHistory: string;
  estimatedTokens: number;
}> {

  // QUICK WIN 1: Adaptive Context Based on Query Type
  const queryTokens = userMessage.split(' ').length;
  const isSimple = queryTokens < 20 && !userMessage.includes('?');

  const contextWindow = isSimple
    ? `${context.name} - ${context.shortDescription}`  // ~150 tokens
    : buildFullContext(context);  // ~2000 tokens

  // QUICK WIN 2: Compressed System Prompt
  const systemPrompt = 'Customer service bot for pizza restaurant. Help with orders, menu, delivery, complaints. Be helpful. If unsure, ask for clarification.';  // 85 tokens

  // QUICK WIN 3: Reduced Message History
  const historyWindow = isSimple ? 1 : 3;
  const messageHistory = context.messages
    .slice(-historyWindow)
    .map((m: any) => `${m.direction}: ${m.text}`)
    .join('\n');

  const estimatedTokens = 85 + contextWindow.split(' ').length * 1.3 +
    messageHistory.split(' ').length * 1.3 + userMessage.split(' ').length * 1.3;

  return {
    systemPrompt,
    contextWindow,
    messageHistory,
    estimatedTokens
  };
}
```

---

## Summary Table

| Strategy | Implementation | Savings | Time | Priority |
|----------|---|---|---|---|
| **1.1: Adaptive Context** | 1-2h | 20-30% | LOW | 🔴 HIGH |
| **1.2: Compressed Prompt** | 0.5h | 10-15% | LOW | 🔴 HIGH |
| **1.3: Smart History** | 1h | 15-25% | LOW | 🔴 HIGH |
| **2.1: Caching** | 4-6h | 20-40% | MEDIUM | 🟠 MEDIUM |
| **2.2: Summarization** | 3-4h | 15-25% | MEDIUM | 🟠 MEDIUM |
| **2.3: Batch Embed** | 4-5h | 15-20% | MEDIUM | 🟠 MEDIUM |
| **3.1: Model Selection** | 8-10h | 30-50% | HARD | 🟡 MEDIUM |
| **3.2: Local Inference** | 10-12h | 25-35% | HARD | 🟡 LOW |

**Total Implementation: 35-40 hours over 5-6 weeks**
**Total Potential Savings: 55-75% reduction = ₹3,400-7,400/month**

---

This is your complete optimization strategy. Which phase would you like to start implementing first?
