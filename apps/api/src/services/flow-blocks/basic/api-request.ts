import { getNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockModule, FlowVariables } from "../types.js";

type ApiRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiRequestBodyMode = "none" | "json" | "text";

interface ApiRequestKeyValue {
  key: string;
  value: string;
}

interface ApiResponseMapping {
  variableName: string;
  path: string;
}

function normalizeMethod(value: unknown): ApiRequestMethod {
  switch (String(value ?? "GET").trim().toUpperCase()) {
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
      return String(value).trim().toUpperCase() as ApiRequestMethod;
    default:
      return "GET";
  }
}

function normalizeBodyMode(value: unknown): ApiRequestBodyMode {
  switch (String(value ?? "none").trim().toLowerCase()) {
    case "json":
    case "text":
      return String(value).trim().toLowerCase() as ApiRequestBodyMode;
    default:
      return "none";
  }
}

function normalizeVariableName(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\{\{|\}\}/g, "")
    .trim()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function readKeyValuePairs(value: unknown): ApiRequestKeyValue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const pair = (item ?? {}) as { key?: unknown; value?: unknown };
      return {
        key: String(pair.key ?? "").trim(),
        value: String(pair.value ?? "")
      };
    })
    .filter((pair) => pair.key);
}

function readResponseMappings(value: unknown): ApiResponseMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const mapping = (item ?? {}) as {
        variableName?: unknown;
        path?: unknown;
      };
      return {
        variableName: normalizeVariableName(mapping.variableName, ""),
        path: String(mapping.path ?? "").trim()
      };
    })
    .filter((mapping) => mapping.variableName && mapping.path);
}

function parseTimeout(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15000;
  }
  return Math.min(parsed, 120000);
}

function shouldSendBody(method: ApiRequestMethod): boolean {
  return !["GET", "DELETE"].includes(method);
}

function parseJsonLoose(value: string): unknown {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function serializeVariableValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function tokenizePath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getValueAtPath(input: unknown, path: string): unknown {
  if (!path.trim()) {
    return input;
  }

  let current: unknown = input;
  for (const token of tokenizePath(path)) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return null;
      }
      current = current[index];
      continue;
    }

    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
      continue;
    }

    return null;
  }

  return current;
}

function buildRequestHeaders(
  pairs: ApiRequestKeyValue[],
  vars: FlowVariables,
  bodyMode: ApiRequestBodyMode
): Headers {
  const headers = new Headers();

  for (const pair of pairs) {
    headers.set(pair.key, interpolate(pair.value, vars));
  }

  if (bodyMode === "json" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (bodyMode === "text" && !headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  if (!headers.has("accept")) {
    headers.set("accept", "application/json, text/plain;q=0.9, */*;q=0.8");
  }

  return headers;
}

function buildRequestBody(params: {
  method: ApiRequestMethod;
  bodyMode: ApiRequestBodyMode;
  bodyTemplate: string;
  vars: FlowVariables;
}): string | undefined {
  const { method, bodyMode, bodyTemplate, vars } = params;
  if (!shouldSendBody(method) || bodyMode === "none") {
    return undefined;
  }

  const body = interpolate(bodyTemplate, vars).trim();
  if (!body) {
    return undefined;
  }

  if (bodyMode === "json") {
    // parseJsonLoose returns raw string on invalid JSON — stringify re-encodes on success
    const parsed = parseJsonLoose(body);
    return typeof parsed === "string" ? body : JSON.stringify(parsed);
  }

  return body;
}

function buildMappedVariables(params: {
  prefix: string;
  responseBody: unknown;
  mappings: ApiResponseMapping[];
}): FlowVariables {
  const { responseBody, mappings } = params;
  const mapped: FlowVariables = {};

  for (const mapping of mappings) {
    mapped[mapping.variableName] = serializeVariableValue(
      getValueAtPath(responseBody, mapping.path)
    );
  }

  return mapped;
}

function buildResultVariables(params: {
  existing: FlowVariables;
  prefix: string;
  url: string;
  durationMs: number;
  responseStatus: number;
  responseOk: boolean;
  responseStatusText: string;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  responsePath: string;
  mappings: ApiResponseMapping[];
  errorMessage?: string;
}): FlowVariables {
  const {
    existing,
    prefix,
    url,
    durationMs,
    responseStatus,
    responseOk,
    responseStatusText,
    responseHeaders,
    responseBody,
    responsePath,
    mappings,
    errorMessage
  } = params;

  const selectedValue = getValueAtPath(responseBody, responsePath);

  return {
    ...existing,
    [prefix]: serializeVariableValue(
      responsePath.trim() ? selectedValue : responseBody
    ),
    [`${prefix}_body`]: serializeVariableValue(responseBody),
    [`${prefix}_payload`]: responseBody,
    [`${prefix}_status`]: responseStatus,
    [`${prefix}_status_text`]: responseStatusText,
    [`${prefix}_ok`]: responseOk,
    [`${prefix}_url`]: url,
    [`${prefix}_duration_ms`]: durationMs,
    [`${prefix}_headers`]: responseHeaders,
    ...(errorMessage ? { [`${prefix}_error`]: errorMessage } : {}),
    ...buildMappedVariables({
      prefix,
      responseBody,
      mappings
    })
  };
}

export const apiRequestBlock: FlowBlockModule = {
  type: "apiRequest",
  async execute(context) {
    const method = normalizeMethod(context.node.data.method);
    const url = interpolate(String(context.node.data.url ?? ""), context.vars).trim();
    const bodyMode = normalizeBodyMode(context.node.data.bodyMode);
    const bodyTemplate = String(context.node.data.body ?? "");
    const timeoutMs = parseTimeout(context.node.data.timeoutMs);
    const responseVariable = normalizeVariableName(
      context.node.data.saveResponseAs,
      "api_response"
    );
    const responsePath = String(context.node.data.responsePath ?? "").trim();
    const headers = buildRequestHeaders(
      readKeyValuePairs(context.node.data.headers),
      context.vars,
      bodyMode
    );
    const responseMappings = readResponseMappings(context.node.data.responseMappings);
    const startedAt = Date.now();

    try {
      const requestBody = buildRequestBody({
        method,
        bodyMode,
        bodyTemplate,
        vars: context.vars
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: requestBody,
          signal: controller.signal
        });
        const rawBody = await response.text();
        const responseBody = parseJsonLoose(rawBody);
        const resultVars = buildResultVariables({
          existing: context.vars,
          prefix: responseVariable,
          url,
          durationMs: Date.now() - startedAt,
          responseStatus: response.status,
          responseOk: response.ok,
          responseStatusText: response.statusText,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody,
          responsePath,
          mappings: responseMappings,
          errorMessage: response.ok
            ? undefined
            : serializeVariableValue(getValueAtPath(responseBody, responsePath) ?? responseBody) ||
              response.statusText ||
              `Request failed with status ${response.status}`
        });

        return {
          signal: "continue",
          nextNodeId: getNextNodeId(
            context.nodes,
            context.edges,
            context.node.id,
            response.ok ? "success" : "fail"
          ),
          variables: resultVars
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === "AbortError"
            ? `Request timed out after ${timeoutMs}ms`
            : error.message
          : "API request failed";

      return {
        signal: "continue",
        nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
        variables: buildResultVariables({
          existing: context.vars,
          prefix: responseVariable,
          url,
          durationMs: Date.now() - startedAt,
          responseStatus: 0,
          responseOk: false,
          responseStatusText: "REQUEST_FAILED",
          responseHeaders: {},
          responseBody: "",
          responsePath,
          mappings: responseMappings,
          errorMessage: message
        })
      };
    }
  }
};
