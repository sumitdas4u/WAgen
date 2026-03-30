import { useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useFlowEditorToken, useNodePatch } from "../editor-shared";
import { API_URL } from "../../../../../../lib/api";
import type {
  ApiRequestData,
  ApiResponseMapping,
  StudioFlowBlockDefinition
} from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePair() {
  return { id: uid(), key: "", value: "" };
}

function makeMapping(): ApiResponseMapping {
  return { id: uid(), variableName: "", path: "" };
}

/** Flatten a JSON value into all leaf dot-paths, e.g. { data: { name: "X" } } → ["data.name"] */
function flattenPaths(value: unknown, prefix = "", out: Array<{ path: string; value: unknown }> = []) {
  if (value === null || value === undefined) {
    out.push({ path: prefix, value });
    return out;
  }
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, 5);
    for (let i = 0; i < limit; i++) {
      flattenPaths(value[i], prefix ? `${prefix}[${i}]` : `[${i}]`, out);
    }
    return out;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length === 0) {
      out.push({ path: prefix, value });
      return out;
    }
    for (const key of keys.slice(0, 40)) {
      flattenPaths((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.push({ path: prefix, value });
  return out;
}

function pathToVariableName(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, "_$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function previewValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`;
  if (typeof value === "object") return JSON.stringify(value).slice(0, 50);
  return String(value);
}

/** Extract all unique {{var}} tokens from a string */
function extractVars(text: string): string[] {
  const matches = text.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/** Replace {{var}} tokens using a values map */
function interpolateVars(text: string, vals: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vals[key] ?? `{{${key}}}`);
}

// ─── Test state ───────────────────────────────────────────────────────────────

interface TestState {
  loading: boolean;
  error: string | null;
  status: number | null;
  ok: boolean | null;
  durationMs: number | null;
  body: unknown;
  rawBody: string;
}

const IDLE: TestState = {
  loading: false, error: null, status: null, ok: null, durationMs: null, body: null, rawBody: ""
};

// ─── Node component ───────────────────────────────────────────────────────────

function ApiRequestNode({ id, data, selected }: NodeProps<ApiRequestData>) {
  const { patch, del } = useNodePatch<ApiRequestData>(id);
  const token = useFlowEditorToken();

  const [testState, setTestState] = useState<TestState>(IDLE);
  const [testOpen, setTestOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedVarName, setSelectedVarName] = useState("");
  const [testVars, setTestVars] = useState<Record<string, string>>({});

  const isBodyMethod = data.method !== "GET" && data.method !== "DELETE";
  const hasBody = isBodyMethod && data.bodyMode !== "none";

  // Collect all {{var}} tokens across URL, header values, and body
  const detectedVars = useMemo(() => {
    const sources = [
      data.url,
      ...data.headers.map((h) => h.value),
      data.body
    ].join(" ");
    return extractVars(sources);
  }, [data.url, data.headers, data.body]);

  const leafPaths = testState.body != null
    ? flattenPaths(testState.body)
    : [];

  const runTest = async () => {
    setTestState({ ...IDLE, loading: true });
    setSelectedPath("");
    setSelectedVarName("");

    // Substitute {{var}} with test values before sending
    const resolvedUrl = interpolateVars(data.url, testVars);
    const resolvedHeaders = data.headers
      .filter((h) => h.key.trim())
      .map((h) => ({ key: h.key, value: interpolateVars(h.value, testVars) }));
    const resolvedBody = interpolateVars(data.body, testVars);

    try {
      const res = await fetch(`${API_URL}/api/flows/test-api-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          method: data.method,
          url: resolvedUrl,
          headers: resolvedHeaders,
          bodyMode: data.bodyMode,
          body: resolvedBody,
          timeoutMs: Number(data.timeoutMs) || 15000
        })
      });
      const json = await res.json() as {
        ok?: boolean; status?: number; statusText?: string;
        durationMs?: number; body?: unknown; rawBody?: string; error?: string;
      };
      if (!res.ok) {
        setTestState({ ...IDLE, error: json.error ?? `Server error ${res.status}` });
        return;
      }
      setTestState({
        loading: false,
        error: null,
        status: json.status ?? res.status,
        ok: json.ok ?? res.ok,
        durationMs: json.durationMs ?? null,
        body: json.body ?? null,
        rawBody: json.rawBody ?? ""
      });
    } catch (err) {
      setTestState({ ...IDLE, error: (err as Error).message });
    }
  };

  const addMapping = () => {
    if (!selectedPath) return;
    const varName = selectedVarName.trim() || pathToVariableName(selectedPath);
    patch({ responseMappings: [...data.responseMappings, { id: uid(), path: selectedPath, variableName: varName }] });
    setSelectedPath("");
    setSelectedVarName("");
  };

  return (
    <div className={`fn-node fn-node-apiRequest${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="🌐" title="API Request" onDelete={del} />
      <div className="fn-node-body">

        {/* Method + Timeout */}
        <div className="fn-two">
          <div className="fn-node-field">
            <label className="fn-node-label">METHOD</label>
            <select
              className="fn-node-select nodrag"
              value={data.method}
              onChange={(e) =>
                patch({
                  method: e.target.value as ApiRequestData["method"],
                  bodyMode:
                    e.target.value === "GET" || e.target.value === "DELETE"
                      ? "none"
                      : data.bodyMode === "none" ? "json" : data.bodyMode
                })
              }
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="fn-node-field">
            <label className="fn-node-label">TIMEOUT (MS)</label>
            <input
              className="fn-node-input nodrag"
              value={data.timeoutMs}
              onChange={(e) => patch({ timeoutMs: e.target.value })}
              placeholder="15000"
            />
          </div>
        </div>

        {/* URL */}
        <div className="fn-node-field">
          <label className="fn-node-label">URL</label>
          <input
            className="fn-node-input nodrag"
            value={data.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://api.example.com/users/{{user_id}}"
          />
        </div>

        {/* Headers */}
        <div className="fn-node-field">
          <label className="fn-node-label">HEADERS</label>
          <div className="fn-btn-rows">
            {data.headers.length > 0 && (
              <div className="fn-api-row" style={{ opacity: 0.45, pointerEvents: "none" }}>
                <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>Key</span>
                <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>Value</span>
                <span />
              </div>
            )}
            {data.headers.map((h) => (
              <div key={h.id} className="fn-api-row">
                <input
                  className="fn-btn-row-input nodrag"
                  value={h.key}
                  onChange={(e) =>
                    patch({ headers: data.headers.map((x) => x.id === h.id ? { ...x, key: e.target.value } : x) })
                  }
                  placeholder="Authorization"
                />
                <input
                  className="fn-btn-row-input nodrag"
                  value={h.value}
                  onChange={(e) =>
                    patch({ headers: data.headers.map((x) => x.id === h.id ? { ...x, value: e.target.value } : x) })
                  }
                  placeholder="Bearer {{token}}"
                />
                <button type="button" className="fn-icon-btn nodrag"
                  onClick={() => patch({ headers: data.headers.filter((x) => x.id !== h.id) })}>
                  x
                </button>
              </div>
            ))}
            <button type="button" className="fn-add-btn nodrag"
              onClick={() => patch({ headers: [...data.headers, makePair()] })}>
              + Add Header
            </button>
          </div>
        </div>

        {/* Body */}
        {isBodyMethod && (
          <div className="fn-node-field">
            <label className="fn-node-label">BODY</label>
            <select
              className="fn-node-select nodrag"
              value={data.bodyMode}
              onChange={(e) => patch({ bodyMode: e.target.value as ApiRequestData["bodyMode"] })}
              style={{ marginBottom: hasBody ? "0.32rem" : 0 }}
            >
              <option value="none">No body</option>
              <option value="json">JSON</option>
              <option value="text">Plain text</option>
            </select>
            {hasBody && (
              <textarea
                className="fn-node-textarea nodrag"
                value={data.body}
                onChange={(e) => patch({ body: e.target.value })}
                placeholder={
                  data.bodyMode === "json"
                    ? '{"name":"{{contact_name}}","phone":"{{phone}}"}'
                    : "Plain text with {{variables}}"
                }
                rows={3}
              />
            )}
          </div>
        )}

        {/* Save response */}
        <div className="fn-node-field">
          <label className="fn-node-label">SAVE FULL RESPONSE AS</label>
          <input
            className="fn-node-input nodrag"
            value={data.saveResponseAs}
            onChange={(e) => patch({ saveResponseAs: e.target.value })}
            placeholder="api_response"
          />
          <div className="fn-api-hint" style={{ marginTop: "0.18rem" }}>
            Use <code style={{ fontSize: "0.65rem" }}>{"{{api_response_status}}"}</code>,{" "}
            <code style={{ fontSize: "0.65rem" }}>{"{{api_response_ok}}"}</code>,{" "}
            <code style={{ fontSize: "0.65rem" }}>{"{{api_response_error}}"}</code> in later nodes.
          </div>
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">EXTRACT PATH (optional)</label>
          <input
            className="fn-node-input nodrag"
            value={data.responsePath}
            onChange={(e) => patch({ responsePath: e.target.value })}
            placeholder="data.result"
          />
          <div className="fn-api-hint" style={{ marginTop: "0.18rem" }}>
            Extracts this dot-path into the variable above, e.g. <code style={{ fontSize: "0.65rem" }}>data.name</code>
          </div>
        </div>

        {/* Field mappings */}
        <div className="fn-node-field">
          <label className="fn-node-label">FIELD MAPPINGS</label>
          <div className="fn-btn-rows">
            {data.responseMappings.length > 0 && (
              <div className="fn-api-row" style={{ opacity: 0.45, pointerEvents: "none" }}>
                <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>JSON path</span>
                <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>→ Variable</span>
                <span />
              </div>
            )}
            {data.responseMappings.map((m) => (
              <div key={m.id} className="fn-api-row">
                <input
                  className="fn-btn-row-input nodrag"
                  value={m.path}
                  onChange={(e) =>
                    patch({
                      responseMappings: data.responseMappings.map((x) =>
                        x.id === m.id ? { ...x, path: e.target.value } : x
                      )
                    })
                  }
                  placeholder="data.customer.name"
                />
                <input
                  className="fn-btn-row-input nodrag"
                  value={m.variableName}
                  onChange={(e) =>
                    patch({
                      responseMappings: data.responseMappings.map((x) =>
                        x.id === m.id ? { ...x, variableName: e.target.value } : x
                      )
                    })
                  }
                  placeholder="customer_name"
                />
                <button type="button" className="fn-icon-btn nodrag"
                  onClick={() =>
                    patch({ responseMappings: data.responseMappings.filter((x) => x.id !== m.id) })
                  }>
                  x
                </button>
              </div>
            ))}
            <button type="button" className="fn-add-btn nodrag"
              onClick={() => patch({ responseMappings: [...data.responseMappings, makeMapping()] })}>
              + Add Mapping
            </button>
          </div>
          {data.responseMappings.length === 0 && (
            <div className="fn-api-hint" style={{ marginTop: "0.2rem" }}>
              Extract fields: <code style={{ fontSize: "0.65rem" }}>data.name</code> →{" "}
              <code style={{ fontSize: "0.65rem" }}>customer_name</code>, then use{" "}
              <code style={{ fontSize: "0.65rem" }}>{"{{customer_name}}"}</code> in next nodes.
            </div>
          )}
        </div>

        {/* ── Test API panel ──────────────────────────────────────────── */}
        <div className="fn-test-panel">
          <button
            type="button"
            className={`fn-test-toggle nodrag${testOpen ? " fn-test-toggle-open" : ""}`}
            onClick={() => setTestOpen((v) => !v)}
          >
            <span>🧪 Test API</span>
            <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>{testOpen ? "▲" : "▼"}</span>
          </button>

          {testOpen && (
            <div className="fn-test-body">

              {/* Variable inputs — shown whenever {{vars}} are detected */}
              {detectedVars.length > 0 && (
                <div className="fn-test-vars">
                  <div className="fn-test-vars-label">Test variables</div>
                  {detectedVars.map((varName) => (
                    <div key={varName} className="fn-test-var-row">
                      <code className="fn-test-var-tag">{`{{${varName}}}`}</code>
                      <input
                        className="fn-btn-row-input nodrag"
                        value={testVars[varName] ?? ""}
                        onChange={(e) =>
                          setTestVars((prev) => ({ ...prev, [varName]: e.target.value }))
                        }
                        placeholder={`value for ${varName}`}
                      />
                    </div>
                  ))}
                  {/* Show resolved URL preview */}
                  {data.url.includes("{{") && (
                    <div className="fn-api-hint fn-test-url-preview" style={{ wordBreak: "break-all" }}>
                      <span style={{ fontWeight: 600 }}>→ </span>
                      {interpolateVars(data.url, testVars)}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                className="fn-test-run-btn nodrag"
                disabled={testState.loading || !data.url.trim()}
                onClick={runTest}
              >
                {testState.loading ? "Sending…" : "▶ Send Request"}
              </button>

              {/* Status bar */}
              {testState.status != null && (
                <div className={`fn-test-status ${testState.ok ? "fn-test-ok" : "fn-test-fail"}`}>
                  <span>{testState.ok ? "✓" : "✗"} HTTP {testState.status}</span>
                  {testState.durationMs != null && (
                    <span style={{ marginLeft: "auto", opacity: 0.7 }}>{testState.durationMs}ms</span>
                  )}
                </div>
              )}

              {/* Error */}
              {testState.error && (
                <div className="fn-test-error">{testState.error}</div>
              )}

              {/* Raw response */}
              {testState.rawBody && (
                <div className="fn-node-field">
                  <label className="fn-node-label">RESPONSE</label>
                  <textarea
                    className="fn-node-textarea nodrag"
                    readOnly
                    value={
                      (() => {
                        try {
                          return JSON.stringify(JSON.parse(testState.rawBody), null, 2);
                        } catch {
                          return testState.rawBody;
                        }
                      })()
                    }
                    rows={6}
                    style={{ fontFamily: "monospace", fontSize: "0.68rem", resize: "vertical" }}
                  />
                </div>
              )}

              {/* Path explorer */}
              {leafPaths.length > 0 && (
                <div className="fn-node-field">
                  <label className="fn-node-label">RESPONSE PATHS</label>
                  <div className="fn-api-hint" style={{ marginBottom: "0.3rem" }}>
                    Select a field to add it as a variable mapping.
                  </div>
                  <div className="fn-test-paths nodrag">
                    {leafPaths.map(({ path, value }) => (
                      <button
                        key={path}
                        type="button"
                        className={`fn-test-path-row nodrag${selectedPath === path ? " fn-test-path-selected" : ""}`}
                        onClick={() => {
                          setSelectedPath(path);
                          setSelectedVarName(pathToVariableName(path));
                        }}
                      >
                        <code className="fn-test-path-key">{path}</code>
                        <span className="fn-test-path-val">{previewValue(value)}</span>
                      </button>
                    ))}
                  </div>

                  {selectedPath && (
                    <div className="fn-test-add-mapping">
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "0.25rem" }}>
                        Add as variable:
                      </div>
                      <div className="fn-api-row">
                        <input
                          className="fn-btn-row-input nodrag"
                          value={selectedPath}
                          readOnly
                          style={{ opacity: 0.7, fontSize: "0.68rem" }}
                        />
                        <input
                          className="fn-btn-row-input nodrag"
                          value={selectedVarName}
                          onChange={(e) => setSelectedVarName(e.target.value)}
                          placeholder="variable_name"
                        />
                        <button
                          type="button"
                          className="fn-icon-btn nodrag"
                          style={{ background: "#10b981", color: "#fff", fontWeight: 700, padding: "0 8px" }}
                          onClick={addMapping}
                          title="Add mapping"
                        >
                          +
                        </button>
                      </div>
                      <div className="fn-api-hint" style={{ marginTop: "0.18rem" }}>
                        Use <code style={{ fontSize: "0.65rem" }}>{`{{${selectedVarName || "variable_name"}}}`}</code> in later nodes.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Success / Fail output handles */}
        <div className="fn-api-outputs">
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-true" />
            <span>Success (2xx)</span>
            <Handle
              type="source"
              position={Position.Right}
              id="success"
              className="fn-handle-out fn-handle-success"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
          <div className="fn-api-branch">
            <span className="fn-cond-dot fn-cond-dot-false" />
            <span>Fail / Timeout</span>
            <Handle
              type="source"
              position={Position.Right}
              id="fail"
              className="fn-handle-out fn-handle-fail"
              style={{ position: "absolute", right: -7 }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}

export const apiRequestStudioBlock: StudioFlowBlockDefinition<ApiRequestData> = {
  kind: "apiRequest",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "apiRequest",
    icon: "🌐",
    name: "API Request",
    desc: "Call external GET/POST APIs",
    section: "Actions",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "apiRequest",
      method: "GET",
      url: "",
      headers: [],
      bodyMode: "none",
      body: "",
      timeoutMs: "15000",
      saveResponseAs: "api_response",
      responsePath: "",
      responseMappings: []
    };
  },
  NodeComponent: ApiRequestNode
};
