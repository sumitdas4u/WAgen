import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const tracingEnabled = process.env.OTEL_TRACING_ENABLED === "true";

if (tracingEnabled) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS;

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "wagen-api",
    instrumentations: [getNodeAutoInstrumentations()],
    traceExporter: endpoint
      ? new OTLPTraceExporter({
          url: endpoint,
          headers: headers ? parseHeaders(headers) : undefined
        })
      : new ConsoleSpanExporter()
  });

  sdk.start();
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

