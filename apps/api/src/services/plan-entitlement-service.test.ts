import { describe, expect, it } from "vitest";
import { assertPlanCapLimit, PlanLimitExceededError } from "./plan-entitlement-service.js";

describe("assertPlanCapLimit", () => {
  it("resolves when used < limit", async () => {
    await expect(
      assertPlanCapLimit({ used: 0, limit: 1, module: "flows" })
    ).resolves.toBeUndefined();
  });

  it("throws PlanLimitExceededError when used >= limit", async () => {
    await expect(
      assertPlanCapLimit({ used: 1, limit: 1, module: "flows" })
    ).rejects.toBeInstanceOf(PlanLimitExceededError);
  });

  it("error contains used, limit, and module", async () => {
    const err = await assertPlanCapLimit({ used: 2, limit: 1, module: "broadcast" }).catch(e => e);
    expect(err).toBeInstanceOf(PlanLimitExceededError);
    expect(err.used).toBe(2);
    expect(err.limit).toBe(1);
    expect(err.module).toBe("broadcast");
    expect(err.code).toBe("plan_limit_exceeded");
  });
});
