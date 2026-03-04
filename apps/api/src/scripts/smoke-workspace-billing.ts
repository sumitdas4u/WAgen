import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { createUser } from "../services/user-service.js";
import {
  adjustWorkspaceCreditsByAdmin,
  evaluateConversationCredit,
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

    const first = await evaluateConversationCredit({
      userId: user.id,
      customerIdentifier: "919900000001"
    });
    assert.equal(first.allowed, true, "first conversation should be allowed");
    assert.equal(first.deducted, true, "first conversation should deduct one credit");
    assert.equal(first.remainingCredits, env.TRIAL_CREDITS - 1, "remaining should decrement by 1");

    const sameWindow = await evaluateConversationCredit({
      userId: user.id,
      customerIdentifier: "919900000001"
    });
    assert.equal(sameWindow.allowed, true, "same-window conversation should be allowed");
    assert.equal(sameWindow.deducted, false, "same-window conversation should not deduct credit");
    assert.equal(
      sameWindow.remainingCredits,
      env.TRIAL_CREDITS - 1,
      "same-window conversation should not change credits"
    );

    await pool.query(
      `UPDATE conversation_sessions
       SET last_message_time = NOW() - (($2::int + 1)::text || ' hours')::interval
       WHERE workspace_id = $1
         AND customer_phone = $3`,
      [first.workspaceId, env.CONVERSATION_WINDOW_HOURS, "919900000001"]
    );

    const nextWindow = await evaluateConversationCredit({
      userId: user.id,
      customerIdentifier: "919900000001"
    });
    assert.equal(nextWindow.allowed, true, "new 24h window should be allowed");
    assert.equal(nextWindow.deducted, true, "new 24h window should deduct one credit");
    assert.equal(nextWindow.remainingCredits, env.TRIAL_CREDITS - 2, "remaining should decrement again");

    await pool.query(
      `UPDATE credit_wallet
       SET total_credits = 2,
           used_credits = 2,
           remaining_credits = 0
       WHERE workspace_id = $1`,
      [first.workspaceId]
    );

    const blocked = await evaluateConversationCredit({
      userId: user.id,
      customerIdentifier: "919900000999"
    });
    assert.equal(blocked.allowed, false, "new conversation with zero credits should be blocked");
    assert.equal(blocked.deducted, false, "blocked conversation should not deduct credits");

    const adjusted = await adjustWorkspaceCreditsByAdmin({
      workspaceId: first.workspaceId,
      deltaCredits: 5,
      reason: "smoke test top-up"
    });
    assert.equal(adjusted.remainingCredits, 5, "admin top-up should increase remaining credits");

    await pool.query(
      `UPDATE subscriptions
       SET status = 'active',
           next_billing_date = NOW() - INTERVAL '1 day'
       WHERE workspace_id = $1`,
      [first.workspaceId]
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

