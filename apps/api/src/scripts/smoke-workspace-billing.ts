import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { createUser } from "../services/user-service.js";
import { chargeUser, getTokenBalance, requireAiCredit } from "../services/ai-token-service.js";
import {
  adjustWorkspaceCreditsByAdmin,
  getWorkspaceCreditsByUserId,
  renewDueWorkspaceCredits
} from "../services/workspace-billing-service.js";

async function run(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const user = await createUser({
    name: `Smoke ${suffix}`,
    email: `smoke-${suffix}@example.com`,
    password: "StrongPass123!",
    businessType: "Smoke Workspace"
  });

  try {
    const initial = await getWorkspaceCreditsByUserId(user.id);
    assert.equal(initial.totalCredits, env.TRIAL_CREDITS, "trial total credits mismatch");
    assert.equal(initial.remainingCredits, env.TRIAL_CREDITS, "trial remaining credits mismatch");

    const initialAiBalance = await getTokenBalance(user.id);
    assert.equal(initialAiBalance, 50, "trial AI credit balance mismatch");

    await requireAiCredit(user.id, "chatbot_reply");
    const charged = await chargeUser(user.id, "chatbot_reply", "smoke-ai-reply", {
      module: "inbox",
      model: env.OPENAI_CHAT_MODEL,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120
    });
    assert.equal(charged.balanceAfter, initialAiBalance - 1, "AI reply should deduct one AI credit");

    const afterConversationLikeActivity = await getWorkspaceCreditsByUserId(user.id);
    assert.equal(
      afterConversationLikeActivity.remainingCredits,
      initial.remainingCredits,
      "conversation activity should not deduct workspace credits"
    );

    await pool.query(
      `UPDATE credit_wallet
       SET total_credits = 2,
           used_credits = 2,
           remaining_credits = 0
       WHERE workspace_id = $1`,
      [initial.workspaceId]
    );

    const adjusted = await adjustWorkspaceCreditsByAdmin({
      workspaceId: initial.workspaceId,
      deltaCredits: 5,
      reason: "smoke test top-up"
    });
    assert.equal(adjusted.remainingCredits, 5, "admin top-up should increase remaining credits");

    await pool.query(
      `UPDATE subscriptions
       SET status = 'active',
           next_billing_date = NOW() - INTERVAL '1 day'
       WHERE workspace_id = $1`,
      [initial.workspaceId]
    );

    const renewal = await renewDueWorkspaceCredits({ limit: 1000 });
    assert.equal(renewal.renewed >= 1, true, "renewal should process at least one workspace");

    const afterRenewal = await getWorkspaceCreditsByUserId(user.id);
    assert.equal(afterRenewal.usedCredits, 0, "renewal should reset used credits");
    assert.equal(
      afterRenewal.remainingCredits,
      afterRenewal.totalCredits,
      "renewal should reset remaining credits to total"
    );
    const afterRenewalAiBalance = await getTokenBalance(user.id);
    assert.equal(afterRenewalAiBalance, 300, "renewal should reset AI credits to plan quota");

    console.log("Workspace billing smoke test passed.");
  } finally {
    await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  }
}

run()
  .catch((error) => {
    console.error("Workspace billing smoke test failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
