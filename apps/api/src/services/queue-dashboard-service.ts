import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { getManagedQueues, managedQueueNames } from "./queue-service.js";

export const QUEUE_DASHBOARD_PATH = "/api/admin/queues";

let queueDashboardRegistered = false;

export async function registerQueueDashboard(app: FastifyInstance): Promise<void> {
  if (queueDashboardRegistered) {
    return;
  }

  if (!env.REDIS_URL) {
    app.log.warn("Queue dashboard disabled because REDIS_URL is not configured");
    return;
  }

  const queues = getManagedQueues();
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(QUEUE_DASHBOARD_PATH);

  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter
  });

  await app.register(async (dashboardApp) => {
    dashboardApp.addHook("onRequest", dashboardApp.requireSuperAdmin);
    await dashboardApp.register(serverAdapter.registerPlugin(), {
      prefix: QUEUE_DASHBOARD_PATH
    });
  });

  app.get(
    "/api/admin/queue-dashboard",
    { preHandler: [app.requireSuperAdmin] },
    async () => ({
      enabled: true,
      path: QUEUE_DASHBOARD_PATH,
      queues: managedQueueNames
    })
  );

  queueDashboardRegistered = true;
  app.log.info(
    {
      path: QUEUE_DASHBOARD_PATH,
      queues: managedQueueNames
    },
    "Queue dashboard registered"
  );
}
