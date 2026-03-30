import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection
} from "reactflow";
import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { apiRequest } from "../../../../lib/api";
import {
  createDefaultBlockData,
  getPaletteBlocksForChannel,
  isStudioFlowBlockKind,
  studioBlockNodeTypes
} from "./flow-blocks/registry";
import { getConnectionError, validateFlow } from "./flow-validation";
import { FlowEditorContext, uid } from "./flow-blocks/editor-shared";
import type {
  AnyNodeData,
  FlowChannel,
  FlowDoc,
  FlowNode,
  FlowStartData
} from "./flow-blocks/types";
import "reactflow/dist/style.css";
import "./flows.css";

// ─── Channel meta ─────────────────────────────────────────────────────────────

const CHANNEL_META: Record<FlowChannel, { label: string; badge: string; color: string }> = {
  web: { label: "Web Widget", badge: "WEB", color: "#3b82f6" },
  qr: { label: "WhatsApp QR", badge: "QR", color: "#10b981" },
  api: { label: "WhatsApp API", badge: "API", color: "#8b5cf6" }
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function apiFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  return apiRequest<T>(path, { token, ...opts });
}

async function apiListFlows(token: string): Promise<FlowDoc[]> {
  return apiFetch<FlowDoc[]>("/api/flows", token);
}

async function apiCreateFlow(
  token: string,
  name: string,
  channel: FlowChannel
): Promise<FlowDoc> {
  const startId = uid();
  return apiFetch<FlowDoc>("/api/flows", token, {
    method: "POST",
    body: JSON.stringify({
      name,
      channel,
      nodes: [
        {
          id: startId,
          type: "flowStart",
          position: { x: 80, y: 140 },
          data: createDefaultBlockData("flowStart")
        }
      ],
      edges: [],
      triggers: []
    })
  });
}

async function apiUpdateFlow(
  token: string,
  id: string,
  data: Partial<FlowDoc>
): Promise<FlowDoc> {
  return apiFetch<FlowDoc>(`/api/flows/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

async function apiDeleteFlow(token: string, id: string): Promise<void> {
  await apiFetch<void>(`/api/flows/${id}`, token, { method: "DELETE" });
}

async function apiPublishFlow(
  token: string,
  id: string,
  published: boolean
): Promise<FlowDoc> {
  return apiFetch<FlowDoc>(`/api/flows/${id}/publish`, token, {
    method: "POST",
    body: JSON.stringify({ published })
  });
}

// ─── Blocks panel (channel-filtered) ─────────────────────────────────────────

function BlocksPanel({ channel }: { channel: FlowChannel }) {
  const [search, setSearch] = useState("");
  const paletteBlocks = getPaletteBlocksForChannel(channel);
  const filtered = search
    ? paletteBlocks.filter(
        (block) =>
          block.catalog.name.toLowerCase().includes(search.toLowerCase()) ||
          block.catalog.desc.toLowerCase().includes(search.toLowerCase())
      )
    : paletteBlocks;

  const sections = Array.from(new Set(paletteBlocks.map((b) => b.catalog.section)));

  const onDragStart = (event: React.DragEvent<HTMLButtonElement>, kind: string) => {
    event.dataTransfer.setData("application/reactflow-nodekind", kind);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="fn-blocks-panel">
      <div className="fn-blocks-head">
        <h3>Blocks</h3>
        <input
          className="fn-blocks-search nodrag"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="fn-blocks-body">
        {sections.map((section) => {
          const items = filtered.filter((block) => block.catalog.section === section);
          if (!items.length) return null;
          return (
            <div key={section}>
              <div className="fn-block-section-title">{section}</div>
              {items.map((block) => (
                <button
                  key={block.kind}
                  className="fn-block-item"
                  draggable
                  onDragStart={(e) => onDragStart(e, block.kind)}
                >
                  <span className="fn-block-icon">{block.catalog.icon}</span>
                  <div className="fn-block-info">
                    <span className="fn-block-name">{block.catalog.name}</span>
                    <span className="fn-block-desc">{block.catalog.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Flow editor ──────────────────────────────────────────────────────────────

interface FlowEditorInnerProps {
  flow: FlowDoc;
  token: string;
  onChange: (flow: FlowDoc) => void;
  onBack: () => void;
}

function FlowEditorInner({ flow, token, onChange, onBack }: FlowEditorInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNodeData>(flow.nodes as FlowNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [flowName, setFlowName] = useState(flow.name);
  const [live, setLive] = useState(flow.published);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving">("saved");
  const [validationNotice, setValidationNotice] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { project } = useReactFlow();
  const isInitial = useRef(true);
  const latest = useRef({ nodes, edges, flowName, live });
  latest.current = { nodes, edges, flowName, live };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelMeta = CHANNEL_META[flow.channel] ?? CHANNEL_META.api;
  const validation = useMemo(
    () => validateFlow(flow.channel, nodes as FlowNode[], edges),
    [edges, flow.channel, nodes]
  );
  const visibleErrors = validation.errors.slice(0, 5);
  const visibleWarnings = validation.warnings.slice(0, 3);

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    setSaveStatus("dirty");
  }, [nodes, edges, flowName, live]);

  const persistToApi = useCallback(async () => {
    const { nodes: n, edges: e, flowName: name, live: lv } = latest.current;
    const validationResult = validateFlow(flow.channel, n as FlowNode[], e);
    const startNode = (n as FlowNode[]).find((node) => node.type === "flowStart");
    const triggers = (startNode?.data as FlowStartData | undefined)?.triggers ?? [];

    if (lv && validationResult.errors.length > 0) {
      setValidationNotice(
        flow.published
          ? `Fix ${validationResult.errors.length} issue(s) before updating this live flow.`
          : `Fix ${validationResult.errors.length} issue(s) before publishing this flow.`
      );
      return false;
    }

    try {
      const [updated] = await Promise.all([
        apiUpdateFlow(token, flow.id, { name, nodes: n as FlowNode[], edges: e, triggers }),
        lv !== flow.published ? apiPublishFlow(token, flow.id, lv) : Promise.resolve(null)
      ]);
      onChange({ ...flow, ...updated, published: lv });
      setValidationNotice(null);
      return true;
    } catch (err) {
      console.error("[FlowEditor] save failed", err);
      setValidationNotice("Failed to save flow changes.");
      return false;
    }
  }, [flow, onChange, token]);

  useEffect(() => {
    if (saveStatus !== "dirty") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      const saved = await persistToApi();
      setSaveStatus(saved ? "saved" : "dirty");
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [persistToApi, saveStatus]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const error = getConnectionError(connection, nodes as FlowNode[], edges);
      if (error) {
        setValidationNotice(error);
        return;
      }

      setValidationNotice(null);
      setEdges((cur) =>
        addEdge(
          {
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }
          },
          cur
        )
      );
    },
    [edges, nodes, setEdges]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/reactflow-nodekind");
      if (!isStudioFlowBlockKind(kind) || !wrapperRef.current) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const position = project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      setNodes((cur) => [
        ...cur,
        { id: uid(), type: kind, position, data: createDefaultBlockData(kind) }
      ]);
    },
    [project, setNodes]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const saveNow = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    const saved = await persistToApi();
    setSaveStatus(saved ? "saved" : "dirty");
  };

  return (
    <div className="fn-root">
      <div className="fn-topbar">
        <button className="fn-btn fn-btn-back" onClick={onBack}>
          ← Flows
        </button>
        <span
          className="fn-channel-badge"
          style={{ background: channelMeta.color + "18", color: channelMeta.color, border: `1px solid ${channelMeta.color}40` }}
        >
          {channelMeta.badge}
        </span>
        <input
          className="fn-topbar-name nodrag"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
        />
        <span className="fn-topbar-sep" />
        <span className={`fn-save-status ${saveStatus}`}>
          {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Unsaved changes"}
        </span>
        <button className="fn-btn" onClick={saveNow} disabled={saveStatus !== "dirty"}>
          Save
        </button>
        <div className="fn-toggle-wrap">
          {live && <span className="fn-live-dot" />}
          <span>{live ? "Live" : "Draft"}</span>
          <label className="fn-toggle">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => {
                if (e.target.checked && validation.errors.length > 0) {
                  setValidationNotice(
                    `Fix ${validation.errors.length} issue(s) before publishing this flow.`
                  );
                  return;
                }
                setValidationNotice(null);
                setLive(e.target.checked);
              }}
            />
            <span className="fn-toggle-slider" />
          </label>
        </div>
      </div>

      {(validationNotice || validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="fn-editor-alerts">
          {validationNotice && (
            <div className="fn-banner fn-banner-error">{validationNotice}</div>
          )}
          {validation.errors.length > 0 ? (
            <div className="fn-validation-card fn-validation-card-error">
              <div className="fn-validation-title">
                {validation.errors.length} issue(s) blocking publish
              </div>
              <ul className="fn-validation-list">
                {visibleErrors.map((issue) => (
                  <li key={issue.id}>{issue.message}</li>
                ))}
              </ul>
              {validation.errors.length > visibleErrors.length && (
                <div className="fn-validation-more">
                  + {validation.errors.length - visibleErrors.length} more issue(s)
                </div>
              )}
            </div>
          ) : validation.warnings.length > 0 ? (
            <div className="fn-validation-card fn-validation-card-warning">
              <div className="fn-validation-title">
                {validation.warnings.length} warning(s) to review
              </div>
              <ul className="fn-validation-list">
                {visibleWarnings.map((issue) => (
                  <li key={issue.id}>{issue.message}</li>
                ))}
              </ul>
              {validation.warnings.length > visibleWarnings.length && (
                <div className="fn-validation-more">
                  + {validation.warnings.length - visibleWarnings.length} more warning(s)
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="fn-shell">
        <BlocksPanel channel={flow.channel} />
        <div className="fn-canvas" ref={wrapperRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={studioBlockNodeTypes}
            fitView
            deleteKeyCode="Delete"
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c8d6e8" />
            <Controls />
            <MiniMap nodeStrokeWidth={2} pannable zoomable />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

function FlowEditor(props: FlowEditorInnerProps) {
  return (
    <FlowEditorContext.Provider value={{ token: props.token }}>
      <ReactFlowProvider>
        <FlowEditorInner {...props} />
      </ReactFlowProvider>
    </FlowEditorContext.Provider>
  );
}

// ─── Create flow modal ────────────────────────────────────────────────────────

const CHANNELS: FlowChannel[] = ["web", "qr", "api"];

function CreateFlowModal(props: {
  onCreate: (name: string, channel: FlowChannel) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"channel" | "name">("channel");
  const [channel, setChannel] = useState<FlowChannel>("api");
  const [name, setName] = useState("Untitled Flow");

  const handleCreate = () => {
    if (name.trim()) props.onCreate(name.trim(), channel);
  };

  return (
    <>
      <div className="fn-modal-overlay" onClick={props.onClose} />
      <div className="fn-modal">
        {step === "channel" ? (
          <>
            <div className="fn-modal-head">
              <h3>New Flow — Choose Channel</h3>
              <button className="fn-icon-btn" onClick={props.onClose}>x</button>
            </div>
            <div className="fn-modal-body">
              <p style={{ fontSize: "0.8rem", color: "var(--text-3)", marginBottom: "1rem" }}>
                Blocks and capabilities differ by channel. Choose once — it cannot be changed later.
              </p>
              <div className="fn-channel-grid">
                {CHANNELS.map((ch) => {
                  const meta = CHANNEL_META[ch];
                  return (
                    <button
                      key={ch}
                      className={`fn-channel-card${channel === ch ? " selected" : ""}`}
                      onClick={() => setChannel(ch)}
                      style={{ borderColor: channel === ch ? meta.color : undefined }}
                    >
                      <span
                        className="fn-channel-card-badge"
                        style={{ background: meta.color + "22", color: meta.color }}
                      >
                        {meta.badge}
                      </span>
                      <span className="fn-channel-card-label">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fn-modal-foot">
              <button className="fn-btn fn-btn-primary" style={{ width: "100%" }} onClick={() => setStep("name")}>
                Next →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="fn-modal-head">
              <h3>New Flow — Name It</h3>
              <button className="fn-icon-btn" onClick={props.onClose}>x</button>
            </div>
            <div className="fn-modal-body">
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
                <span
                  className="fn-channel-badge"
                  style={{
                    background: CHANNEL_META[channel].color + "18",
                    color: CHANNEL_META[channel].color,
                    border: `1px solid ${CHANNEL_META[channel].color}40`
                  }}
                >
                  {CHANNEL_META[channel].badge}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-2)" }}>{CHANNEL_META[channel].label}</span>
              </div>
              <input
                className="fn-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Flow name..."
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="fn-modal-foot" style={{ display: "flex", gap: "0.5rem" }}>
              <button className="fn-btn" onClick={() => setStep("channel")}>
                ← Back
              </button>
              <button
                className="fn-btn fn-btn-primary"
                style={{ flex: 1 }}
                onClick={handleCreate}
                disabled={!name.trim()}
              >
                Create Flow
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Flow list page ───────────────────────────────────────────────────────────

const CHANNEL_TABS: { key: FlowChannel | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "web", label: "Web Widget" },
  { key: "qr", label: "WhatsApp QR" },
  { key: "api", label: "WhatsApp API" }
];

function FlowsPage() {
  const { token } = useDashboardShell();
  const [flows, setFlows] = useState<FlowDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FlowChannel | "all">("all");
  const [editingFlow, setEditingFlow] = useState<FlowDoc | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiListFlows(token)
      .then((data) => setFlows(data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [token]);

  const handleChange = useCallback((updated: FlowDoc) => {
    setFlows((cur) => cur.map((f) => (f.id === updated.id ? updated : f)));
    setEditingFlow((cur) => (cur?.id === updated.id ? updated : cur));
  }, []);

  const handleCreate = async (name: string, channel: FlowChannel) => {
    setShowCreateModal(false);
    try {
      const created = await apiCreateFlow(token, name, channel);
      setFlows((cur) => [created, ...cur]);
      setEditingFlow(created);
    } catch (e) {
      console.error("Failed to create flow", e);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this flow?")) return;
    try {
      await apiDeleteFlow(token, id);
      setFlows((cur) => cur.filter((f) => f.id !== id));
    } catch (e) {
      console.error("Failed to delete flow", e);
    }
  };

  const handleTogglePublish = async (flow: FlowDoc, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!flow.published) {
      const validation = validateFlow(flow.channel, flow.nodes as FlowNode[], flow.edges);
      if (validation.errors.length > 0) {
        setListNotice(`"${flow.name}" cannot go live yet: ${validation.errors[0]?.message}`);
        return;
      }
    }
    try {
      const updated = await apiPublishFlow(token, flow.id, !flow.published);
      setFlows((cur) => cur.map((f) => (f.id === flow.id ? updated : f)));
      setListNotice(null);
    } catch (e) {
      console.error("Failed to toggle publish", e);
    }
  };

  // ── Editor view
  if (editingFlow) {
    return (
      <FlowEditor
        key={editingFlow.id}
        flow={editingFlow}
        token={token}
        onChange={handleChange}
        onBack={() => setEditingFlow(null)}
      />
    );
  }

  // ── List view
  const filtered = activeTab === "all" ? flows : flows.filter((f) => f.channel === activeTab);

  if (loading) {
    return (
      <div className="fn-page-center" style={{ color: "var(--text-3)", fontSize: "0.85rem" }}>
        Loading flows...
      </div>
    );
  }

  if (error) {
    return (
      <div className="fn-page-center" style={{ color: "#9f1239", fontSize: "0.85rem" }}>
        Failed to load flows: {error}
      </div>
    );
  }

  return (
    <div className="fn-list-root">
      <div className="fn-list-header">
        <div>
          <h2 className="fn-list-title">Flows</h2>
          <p className="fn-list-sub">Automate conversations across channels</p>
        </div>
        <button className="fn-btn fn-btn-primary" onClick={() => setShowCreateModal(true)}>
          + New Flow
        </button>
      </div>

      {listNotice && <div className="fn-banner fn-banner-error">{listNotice}</div>}

      <div className="fn-channel-tabs">
        {CHANNEL_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`fn-channel-tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="fn-tab-count">
              {tab.key === "all" ? flows.length : flows.filter((f) => f.channel === tab.key).length}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="fn-page-center" style={{ flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--text-3)" }}>
            {activeTab === "all" ? "No flows yet." : `No ${CHANNEL_META[activeTab as FlowChannel]?.label ?? ""} flows yet.`}
          </div>
          <button className="fn-btn fn-btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create Flow
          </button>
        </div>
      ) : (
        <div className="fn-flow-grid">
          {filtered.map((flow) => {
            const meta = CHANNEL_META[flow.channel] ?? CHANNEL_META.api;
            return (
              <div key={flow.id} className="fn-flow-card">
                <div className="fn-flow-card-top">
                  <span
                    className="fn-channel-badge"
                    style={{
                      background: meta.color + "18",
                      color: meta.color,
                      border: `1px solid ${meta.color}40`
                    }}
                  >
                    {meta.badge}
                  </span>
                  <button
                    className="fn-icon-btn"
                    title="Delete"
                    onClick={(e) => handleDelete(flow.id, e)}
                  >
                    x
                  </button>
                </div>
                <div className="fn-flow-card-name">{flow.name}</div>
                <div className="fn-flow-card-meta">
                  {(flow.nodes as unknown[]).length} nodes
                </div>
                <div className="fn-flow-card-actions">
                  <button
                    className={`fn-status-btn ${flow.published ? "live" : "draft"}`}
                    onClick={(e) => handleTogglePublish(flow, e)}
                    title={flow.published ? "Click to unpublish" : "Click to publish"}
                  >
                    {flow.published ? "Live" : "Draft"}
                  </button>
                  <button
                    className="fn-btn fn-btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => setEditingFlow(flow)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <CreateFlowModal
          onCreate={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function prefetch(_ctx: DashboardModulePrefetchContext) {
  return {};
}

export function Component() {
  useEffect(() => {
    document.title = "Studio · Flows";
  }, []);

  return <FlowsPage />;
}
