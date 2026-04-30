import type { FastifyReply, FastifyRequest } from "fastify";
import { getUserPlanEntitlements, type PlanEntitlements } from "./billing-service.js";

export type PlanModuleKey = keyof PlanEntitlements["modules"];

export class PlanUpgradeRequiredError extends Error {
  readonly code = "plan_upgrade_required";
  readonly moduleKey: PlanModuleKey;

  constructor(moduleKey: PlanModuleKey) {
    super("Your current subscription does not include this module.");
    this.name = "PlanUpgradeRequiredError";
    this.moduleKey = moduleKey;
  }
}

export async function assertPlanModuleAccess(userId: string, moduleKey: PlanModuleKey): Promise<void> {
  const entitlements = await getUserPlanEntitlements(userId);
  if (!entitlements.modules[moduleKey]) {
    throw new PlanUpgradeRequiredError(moduleKey);
  }
}

export function buildPlanModulePreHandler(moduleKey: PlanModuleKey) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await assertPlanModuleAccess(request.authUser.userId, moduleKey);
    } catch (error) {
      if (error instanceof PlanUpgradeRequiredError) {
        reply.status(403).send({
          error: "plan_upgrade_required",
          message: error.message,
          module: error.moduleKey
        });
        return;
      }
      throw error;
    }
  };
}
