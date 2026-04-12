import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import client from "prom-client";

export interface MetricsOptions {
  enabled: boolean;
  metricsEndpoint: string;
  vitalsEndpoint?: string;
  prefix?: string;
  defaultLabels?: Record<string, string>;
}

export function registerMetrics(app: FastifyInstance, options: MetricsOptions) {
  const vitalsEndpoint = options.vitalsEndpoint ?? "/api/observability/vitals";
  const register = new client.Registry();
  const httpRequestDuration = new client.Histogram({
    name: `${options.prefix ?? ""}http_request_duration_seconds`,
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register]
  });

  const httpRequestsTotal = new client.Counter({
    name: `${options.prefix ?? ""}http_requests_total`,
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [register]
  });

  const webVitals = new client.Histogram({
    name: `${options.prefix ?? ""}web_vital_value`,
    help: "Reported web-vitals values from the browser",
    labelNames: ["app", "name", "rating"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 60],
    registers: [register]
  });

  app.decorate("metrics", {
    enabled: options.enabled,
    register,
    httpRequestDuration,
    httpRequestsTotal,
    webVitals
  });

  if (!options.enabled) {
    // Keep the endpoint available so browsers can report vitals without generating noisy 404s.
    app.post(vitalsEndpoint, async () => ({ ok: true }));
    return;
  }

  if (options.defaultLabels) {
    register.setDefaultLabels(options.defaultLabels);
  }

  client.collectDefaultMetrics({
    register,
    prefix: options.prefix ?? ""
  });

  app.addHook("onRequest", async (request) => {
    (request as FastifyRequest & { _startHr?: bigint })._startHr = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const start = (request as FastifyRequest & { _startHr?: bigint })._startHr;
    if (!start) return;

    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = request.routeOptions?.url ?? request.url;
    const statusCode = String(reply.statusCode);

    httpRequestsTotal.labels(request.method, route, statusCode).inc(1);
    httpRequestDuration.labels(request.method, route, statusCode).observe(durationSeconds);
  });

  app.get(options.metricsEndpoint, async (_, reply: FastifyReply) => {
    const body = await register.metrics();
    reply.header("content-type", register.contentType);
    return body;
  });

  app.post(vitalsEndpoint, async (request, reply) => {
    const body = request.body;
    let parsedBody: unknown = body as unknown;
    if (typeof body === "string") {
      try {
        parsedBody = JSON.parse(body) as unknown;
      } catch {
        return reply.status(400).send({ error: "Invalid vitals payload" });
      }
    }

    const payload = parsedBody as Partial<{
      app: string;
      name: string;
      value: number;
      rating: "good" | "needs-improvement" | "poor";
      navigationType?: string;
      url?: string;
      userAgent?: string;
    }>;

    if (!payload?.app || !payload?.name || typeof payload.value !== "number") {
      return reply.status(400).send({ error: "Invalid vitals payload" });
    }

    webVitals
      .labels(payload.app, payload.name, payload.rating ?? "good")
      .observe(payload.value);

    app.log.info(
      {
        kind: "web-vitals",
        app: payload.app,
        name: payload.name,
        value: payload.value,
        rating: payload.rating,
        url: payload.url,
        navigationType: payload.navigationType,
        requestId: request.id,
        userAgent: payload.userAgent
      },
      "Web vitals reported"
    );

    return { ok: true };
  });
}

declare module "fastify" {
  interface FastifyInstance {
    metrics: {
      enabled: boolean;
      register: client.Registry;
      httpRequestDuration: client.Histogram<"method" | "route" | "status_code">;
      httpRequestsTotal: client.Counter<"method" | "route" | "status_code">;
      webVitals: client.Histogram<"app" | "name" | "rating">;
    };
  }
}
