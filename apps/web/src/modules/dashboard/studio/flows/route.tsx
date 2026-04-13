import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useRoutes } from "react-router-dom";
import ReactFlow, {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Connection,
  type EdgeProps
} from "reactflow";
import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import {
  apiRequest,
  generateFlowDraft as apiGenerateFlowDraftRequest,
  listContactFields,
  type ContactField,
  type GenerateFlowDraftResponse
} from "../../../../lib/api";
import {
  createDefaultBlockData,
  getPaletteBlocksForChannel,
  getStudioFlowBlock,
  isStudioFlowBlockKind,
  studioBlockNodeTypes
} from "./flow-blocks/registry";
import { getConnectionError, validateFlow } from "./flow-validation";
import {
  FlowEditorContext,
  uid,
  type FlowEditorVariableOption
} from "./flow-blocks/editor-shared";
import { FlowVariablePicker, isVariableTarget } from "./flow-blocks/variable-picker";
import type {
  AnyNodeData,
  FlowChannel,
  FlowDoc,
  FlowNode,
  FlowStartData,
  FlowSummary,
  StudioFlowBlockSection
} from "./flow-blocks/types";
import { MetaConnectionSelector, isMetaConnectionActive } from "../../../../shared/dashboard/meta-connection-selector";
import "reactflow/dist/style.css";
import "./flows.css";

// ─── Custom edge with delete button ───────────────────────────────────────────

function ButtonEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style, markerEnd
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          className="fn-edge-delete-btn nodrag nopan"
          style={{ top: labelY, left: labelX }}
          title="Delete connection"
          onClick={() => setEdges((eds) => eds.filter((e) => e.id !== id))}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { buttonEdge: ButtonEdge };


// â”€â”€â”€ Channel meta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CHANNEL_META: Record<FlowChannel, { label: string; badge: string; color: string }> = {
  web: { label: "Web Widget", badge: "WEB", color: "#3b82f6" },
  qr: { label: "WhatsApp QR", badge: "QR", color: "#10b981" },
  api: { label: "WhatsApp API", badge: "API", color: "#8b5cf6" }
};

const BLOCK_SECTION_META: Record<
  StudioFlowBlockSection,
  { icon: string; color: string; label: string }
> = {
  Triggers: { icon: "▶", color: "#0f766e", label: "Triggers" },
  Messages: { icon: "✉", color: "#1d4ed8", label: "Messages" },
  Collect: { icon: "✎", color: "#7c3aed", label: "Collect" },
  Logic: { icon: "◇", color: "#c2410c", label: "Logic" },
  Actions: { icon: "⚙", color: "#155e75", label: "Actions" },
  Commerce: { icon: "₹", color: "#166534", label: "Commerce" }
};

// â”€â”€â”€ API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function apiFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  return apiRequest<T>(path, { token, ...opts });
}

async function apiListFlows(token: string): Promise<FlowSummary[]> {
  return apiFetch<FlowSummary[]>("/api/flows", token);
}

async function apiGetFlow(token: string, id: string): Promise<FlowDoc> {
  return apiFetch<FlowDoc>(`/api/flows/${id}`, token);
}

async function apiCreateFlow(
  token: string,
  name: string,
  channel: FlowChannel,
  options?: { nodes?: FlowNode[]; edges?: FlowDoc["edges"]; triggers?: FlowDoc["triggers"]; connectionId?: string | null }
): Promise<FlowDoc> {
  const startId = uid();
  return apiFetch<FlowDoc>("/api/flows", token, {
    method: "POST",
    body: JSON.stringify({
      name,
      channel,
      connectionId: options?.connectionId ?? null,
      nodes: options?.nodes ?? [
        {
          id: startId,
          type: "flowStart",
          position: { x: 80, y: 140 },
          data: createDefaultBlockData("flowStart")
        }
      ],
      edges: options?.edges ?? [],
      triggers: options?.triggers ?? []
    })
  });
}

async function apiGenerateFlowDraft(token: string, prompt: string, channel: FlowChannel): Promise<GenerateFlowDraftResponse> {
  return apiGenerateFlowDraftRequest(token, { prompt, channel });
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

function summarizeFlow(flow: FlowDoc): FlowSummary {
  return {
    id: flow.id,
    name: flow.name,
    channel: flow.channel,
    connectionId: flow.connectionId ?? null,
    published: flow.published,
    isDefaultReply: flow.isDefaultReply,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
    nodeCount: (flow.nodes as unknown[]).length,
    edgeCount: flow.edges.length,
    triggerCount: flow.triggers.length
  };
}

function formatFlowDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

const BUILT_IN_VARIABLES: FlowEditorVariableOption[] = [
  { id: "contact-name", label: "Name", token: "{{name}}", category: "contact" },
  { id: "contact-phone", label: "Phone", token: "{{phone}}", category: "contact" },
  { id: "contact-email", label: "Email", token: "{{email}}", category: "contact" },
  { id: "contact-type", label: "Contact Type", token: "{{type}}", category: "contact" },
  { id: "contact-tags", label: "Tags", token: "{{tags}}", category: "contact" },
  { id: "contact-source", label: "Source", token: "{{source}}", category: "contact" },
  { id: "contact-source-id", label: "Source ID", token: "{{source_id}}", category: "contact" },
  { id: "contact-source-url", label: "Source URL", token: "{{source_url}}", category: "contact" },
  { id: "conversation-id", label: "Conversation ID", token: "{{conversation.id}}", category: "contact" },
  { id: "conversation-phone", label: "Conversation Phone", token: "{{conversation.phone}}", category: "contact" },
  { id: "conversation-stage", label: "Conversation Stage", token: "{{conversation.stage}}", category: "contact" },
  { id: "conversation-score", label: "Conversation Score", token: "{{conversation.score}}", category: "contact" },
  { id: "conversation-channel", label: "Conversation Channel", token: "{{conversation.channel}}", category: "contact" }
];

function pushFlowVariable(
  map: Map<string, FlowEditorVariableOption>,
  name: string,
  label?: string
) {
  const normalized = name.trim().replace(/\{\{|\}\}/g, "");
  if (!normalized) {
    return;
  }
  map.set(normalized, {
    id: `flow-${normalized}`,
    label: label ?? normalized,
    token: `{{${normalized}}}`,
    category: "flow"
  });
}

function discoverFlowVariableOptions(nodes: FlowNode[]): FlowEditorVariableOption[] {
  const flowVars = new Map<string, FlowEditorVariableOption>();

  for (const node of nodes) {
    const data = node.data;
    switch (data.kind) {
      case "askQuestion":
        pushFlowVariable(flowVars, data.variableName || "answer", "Question Answer");
        break;
      case "askLocation": {
        const base = (data.variableName || "location").trim() || "location";
        pushFlowVariable(flowVars, base, "Location");
        pushFlowVariable(flowVars, `${base}_latitude`, "Location Latitude");
        pushFlowVariable(flowVars, `${base}_longitude`, "Location Longitude");
        pushFlowVariable(flowVars, `${base}_name`, "Location Name");
        pushFlowVariable(flowVars, `${base}_address`, "Location Address");
        pushFlowVariable(flowVars, `${base}_url`, "Location URL");
        pushFlowVariable(flowVars, `${base}_source`, "Location Source");
        break;
      }
      case "aiAgent": {
        const base = (data.saveAs || "ai_agent_result").trim() || "ai_agent_result";
        pushFlowVariable(flowVars, base, "AI Agent Result");
        pushFlowVariable(flowVars, `${base}_ok`);
        pushFlowVariable(flowVars, `${base}_status`);
        pushFlowVariable(flowVars, `${base}_error`);
        pushFlowVariable(flowVars, `${base}_payload`);
        pushFlowVariable(flowVars, `${base}_model`);
        for (const mapping of data.responseMappings) {
          pushFlowVariable(flowVars, mapping.variableName);
        }
        break;
      }
      case "apiRequest": {
        const base = (data.saveResponseAs || "api_response").trim() || "api_response";
        pushFlowVariable(flowVars, base, "API Response");
        pushFlowVariable(flowVars, `${base}_body`);
        pushFlowVariable(flowVars, `${base}_payload`);
        pushFlowVariable(flowVars, `${base}_status`);
        pushFlowVariable(flowVars, `${base}_status_text`);
        pushFlowVariable(flowVars, `${base}_ok`);
        pushFlowVariable(flowVars, `${base}_url`);
        pushFlowVariable(flowVars, `${base}_duration_ms`);
        pushFlowVariable(flowVars, `${base}_headers`);
        pushFlowVariable(flowVars, `${base}_error`);
        for (const mapping of data.responseMappings) {
          pushFlowVariable(flowVars, mapping.variableName);
        }
        break;
      }
      case "googleSheets":
      case "googleSheetsFetchRow":
      case "googleSheetsFetchRows":
      case "googleCalendarBooking": {
        const base = "saveAs" in data ? String(data.saveAs ?? "").trim() : "";
        if (base) {
          pushFlowVariable(flowVars, base);
        }
        if ("fetchMappings" in data && Array.isArray(data.fetchMappings)) {
          for (const mapping of data.fetchMappings) {
            pushFlowVariable(flowVars, mapping.value);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return [...flowVars.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildVariableOptions(
  nodes: FlowNode[],
  contactFields: ContactField[]
): FlowEditorVariableOption[] {
  const customOptions = contactFields
    .filter((field) => field.is_active)
    .map((field) => ({
      id: `custom-${field.id}`,
      label: field.label,
      token: `{{custom.${field.name}}}`,
      category: "custom" as const
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [
    ...BUILT_IN_VARIABLES,
    ...customOptions,
    ...discoverFlowVariableOptions(nodes)
  ];
}

// â”€â”€â”€ Blocks panel (channel-filtered) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          const meta = BLOCK_SECTION_META[section];
          return (
            <div key={section}>
              <div className="fn-block-section-title">
                <span
                  className="fn-block-section-icon"
                  style={{ background: `${meta.color}14`, color: meta.color }}
                >
                  {meta.icon}
                </span>
                <span>{meta.label}</span>
              </div>
              {items.map((block) => (
                <button
                  key={block.kind}
                  className="fn-block-item"
                  draggable
                  onDragStart={(e) => onDragStart(e, block.kind)}
                >
                  <span
                    className="fn-block-icon"
                    style={{ background: `${meta.color}14`, color: meta.color }}
                  >
                    {block.catalog.icon}
                  </span>
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

function FlowNodeEditorSurface({ node }: { node: FlowNode }) {
  const store = useStoreApi();
  const NodeComponent = studioBlockNodeTypes[String(node.type)];

  useEffect(() => {
    const previousOnError = store.getState().onError;

    store.setState({
      onError: (code, message) => {
        if (code === "010") {
          return;
        }
        previousOnError?.(code, message);
      }
    });

    return () => {
      store.setState({ onError: previousOnError });
    };
  }, [store]);

  if (!NodeComponent) {
    return null;
  }

  return (
    <NodeComponent
      {...({
        id: node.id,
        data: node.data,
        selected: true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)}
    />
  );
}

function FlowNodeEditorPanel(props: {
  node: FlowNode | null;
  saveStatus: "saved" | "dirty" | "saving";
  activeVariableTarget: HTMLInputElement | HTMLTextAreaElement | null;
  onFocusVariableTarget: (target: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onClose: () => void;
  onSaveAndClose: () => Promise<void>;
}) {
  const block = props.node ? getStudioFlowBlock(props.node.data.kind) : null;

  return (
    <aside className={`fn-right-panel${props.node ? " open" : ""}`}>
      {props.node && block ? (
        <>
          <div className="fn-right-head">
            <div className="fn-right-head-copy">
              <h3>{block.catalog.name}</h3>
              <p>{block.catalog.desc}</p>
            </div>
            <button className="fn-icon-btn" onClick={props.onClose} title="Close">
              x
            </button>
          </div>
          <div className="fn-right-toolbar">
            <FlowVariablePicker activeTarget={props.activeVariableTarget} />
          </div>
          <div
            className="fn-right-body"
            onFocusCapture={(event) => {
              props.onFocusVariableTarget(
                isVariableTarget(event.target) ? event.target : null
              );
            }}
          >
            <FlowNodeEditorSurface node={props.node} />
          </div>
          <div className="fn-right-foot">
            <span className={`fn-save-status ${props.saveStatus}`}>
              {props.saveStatus === "saved"
                ? "Saved"
                : props.saveStatus === "saving"
                  ? "Saving..."
                  : "Unsaved changes"}
            </span>
            <div className="fn-right-foot-actions">
              <button className="fn-btn" onClick={props.onClose}>
                Close
              </button>
              <button className="fn-btn fn-btn-primary" onClick={props.onSaveAndClose}>
                Save & Close
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="fn-right-empty">
          <h3>Block Config</h3>
          <p>Click any node on the canvas to open its configuration here.</p>
        </div>
      )}
    </aside>
  );
}

// â”€â”€â”€ Flow editor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FlowEditorInnerProps {
  flow: FlowDoc;
  token: string;
  initialNotice?: string | null;
  onChange: (flow: FlowDoc) => void;
  onBack: () => void;
}

function FlowEditorInner({ flow, token, initialNotice, onChange, onBack }: FlowEditorInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNodeData>(flow.nodes as FlowNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [flowName, setFlowName] = useState(flow.name);
  const [live, setLive] = useState(flow.published);
  const [isDefaultReply, setIsDefaultReply] = useState(flow.isDefaultReply ?? false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving">("saved");
  const [isBlocksOpen, setIsBlocksOpen] = useState(true);
  const [validationNotice, setValidationNotice] = useState<string | null>(initialNotice ?? null);
  const [contactFields, setContactFields] = useState<ContactField[]>([]);
  const [activeVariableTarget, setActiveVariableTarget] =
    useState<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { project } = useReactFlow();
  const isInitial = useRef(true);
  const latest = useRef({ nodes, edges, flowName, live, isDefaultReply });
  latest.current = { nodes, edges, flowName, live, isDefaultReply };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelMeta = CHANNEL_META[flow.channel] ?? CHANNEL_META.api;
  const validation = useMemo(
    () => validateFlow(flow.channel, nodes as FlowNode[], edges),
    [edges, flow.channel, nodes]
  );
  const visibleErrors = validation.errors.slice(0, 5);
  const visibleWarnings = validation.warnings.slice(0, 5);
  const selectedNode = useMemo(
    () => (nodes as FlowNode[]).find((node) => node.selected) ?? null,
    [nodes]
  );
  const validationSummary = useMemo(() => {
    if (validation.errors.length > 0) {
      return {
        tone: "error" as const,
        label: `${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"} to fix`
      };
    }
    if (validation.warnings.length > 0) {
      return {
        tone: "warning" as const,
        label: `${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}`
      };
    }
    return {
      tone: "ok" as const,
      label: "Ready to publish"
    };
  }, [validation.errors.length, validation.warnings.length]);
  const variableOptions = useMemo(
    () => buildVariableOptions(nodes as FlowNode[], contactFields),
    [contactFields, nodes]
  );

  useEffect(() => {
    let cancelled = false;
    void listContactFields(token)
      .then((response) => {
        if (!cancelled) {
          setContactFields(response.fields);
        }
      })
      .catch((error) => {
        console.warn("[FlowEditor] Failed to load contact fields", error);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    setActiveVariableTarget(null);
  }, [selectedNode?.id]);
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    setSaveStatus("dirty");
  }, [nodes, edges, flowName, live, isDefaultReply]);

  const persistToApi = useCallback(async () => {
    const { nodes: n, edges: e, flowName: name, live: lv, isDefaultReply: idr } = latest.current;
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
        apiUpdateFlow(token, flow.id, { name, nodes: n as FlowNode[], edges: e, triggers, isDefaultReply: idr }),
        lv !== flow.published ? apiPublishFlow(token, flow.id, lv) : Promise.resolve(null)
      ]);
      onChange({ ...flow, ...updated, published: lv, isDefaultReply: idr });
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
            type: "buttonEdge",
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#64748b" },
            style: { stroke: "#64748b", strokeWidth: 1.5, strokeDasharray: "6,3" }
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

  const closeNodeEditor = useCallback(() => {
    setNodes((current) =>
      current.map((node) => (node.selected ? { ...node, selected: false } : node))
    );
  }, [setNodes]);

  const saveNow = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    const saved = await persistToApi();
    setSaveStatus(saved ? "saved" : "dirty");
    return saved;
  };

  return (
      <FlowEditorContext.Provider value={{ token, contactFields, variableOptions }}>
      <div className="fn-root">
      <div className="fn-topbar">
        <button className="fn-btn fn-btn-back" onClick={onBack}>
          Back to Flows
        </button>
        <div className="fn-topbar-channel">
          <span
            className="fn-channel-badge"
            style={{
              background: channelMeta.color + "18",
              color: channelMeta.color,
              border: `1px solid ${channelMeta.color}40`
            }}
          >
            {channelMeta.badge}
          </span>
          <div className="fn-topbar-channel-copy">
            <strong>{channelMeta.label}</strong>
            <span>Channel</span>
          </div>
        </div>
        <div className="fn-topbar-name-wrap">
          <input
            className="fn-topbar-name-input"
            aria-label="Flow name"
            value={flowName}
            onChange={(event) => setFlowName(event.target.value)}
            placeholder="Flow name"
          />
        </div>
        <span className={`fn-topbar-pill ${saveStatus}`}>
          {saveStatus === "saved"
            ? "Saved"
            : saveStatus === "saving"
              ? "Saving..."
              : "Unsaved"}
        </span>
        <span className={`fn-topbar-pill ${validationSummary.tone}`}>
          {validationSummary.label}
        </span>
        <div className="fn-topbar-live">
          <span>{live ? "Live" : "Draft"}</span>
          <label className="fn-toggle">
            <input
              type="checkbox"
              checked={live}
              onChange={(event) => {
                if (event.target.checked && validation.errors.length > 0) {
                  setValidationNotice(`Fix ${validation.errors.length} issue(s) before publishing this flow.`);
                  return;
                }
                setValidationNotice(null);
                setLive(event.target.checked);
              }}
            />
            <span className="fn-toggle-slider" />
          </label>
        </div>
        <div
          className="fn-topbar-live"
          title={`When enabled, this flow handles all ${CHANNEL_META[flow.channel]?.label ?? flow.channel} messages that don't match another trigger. Only one flow per channel can be the default reply.`}
        >
          <span>Default Reply</span>
          <label className="fn-toggle">
            <input
              type="checkbox"
              checked={isDefaultReply}
              onChange={(event) => {
                setValidationNotice(null);
                setIsDefaultReply(event.target.checked);
              }}
            />
            <span className="fn-toggle-slider" />
          </label>
        </div>
        <span className="fn-topbar-sep" />
        <button className="fn-btn fn-btn-ghost" onClick={() => setIsBlocksOpen((current) => !current)}>
          {isBlocksOpen ? "Hide Block Rail" : "Show Block Rail"}
        </button>
        <button className="fn-btn" onClick={saveNow} disabled={saveStatus !== "dirty"}>
          Save Now
        </button>
      </div>

      {(validationNotice || validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="fn-editor-alerts">
          {validationNotice ? (
            <div className="fn-banner fn-banner-error">{validationNotice}</div>
          ) : (
            <div
              className={`fn-banner ${
                validation.errors.length > 0 ? "fn-banner-error" : "fn-banner-warning"
              }`}
            >
              {validation.errors.length > 0
                ? visibleErrors[0]?.message ?? "Fix the remaining flow issues before publishing."
                : visibleWarnings[0]?.message ?? "Review the remaining warnings."}
            </div>
          )}
        </div>
      )}

      <div className="fn-shell">
        {isBlocksOpen ? <BlocksPanel channel={flow.channel} /> : null}
        <div className="fn-canvas" ref={wrapperRef}>
          {!isBlocksOpen ? (
            <button className="fn-blocks-open-fab" onClick={() => setIsBlocksOpen(true)}>
              + Add Block
            </button>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onPaneClick={closeNodeEditor}
            nodeTypes={studioBlockNodeTypes}
            edgeTypes={EDGE_TYPES}
            fitView
            deleteKeyCode="Delete"
            defaultEdgeOptions={{ type: "buttonEdge", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#64748b" }, style: { stroke: "#64748b", strokeWidth: 1.5, strokeDasharray: "6,3" } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c8d6e8" />
            <Controls />
            <MiniMap nodeStrokeWidth={2} pannable zoomable />
          </ReactFlow>
        </div>
        <FlowNodeEditorPanel
          node={selectedNode}
          saveStatus={saveStatus}
          activeVariableTarget={activeVariableTarget}
          onFocusVariableTarget={(target) => setActiveVariableTarget(target)}
          onClose={closeNodeEditor}
          onSaveAndClose={async () => {
            const saved = await saveNow();
            if (saved) {
              closeNodeEditor();
            }
          }}
        />
      </div>
      </div>
    </FlowEditorContext.Provider>
  );
}

function FlowEditor(props: FlowEditorInnerProps) {
  useEffect(() => {
    document.body.classList.add("flow-builder-mode");
    return () => {
      document.body.classList.remove("flow-builder-mode");
    };
  }, []);

  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

// â”€â”€â”€ Create flow modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CHANNELS: FlowChannel[] = ["web", "qr", "api"];

function CreateFlowModal(props: {
  onCreate: (name: string, channel: FlowChannel, connectionId?: string | null) => void | Promise<void>;
  onCreateWithAi: (prompt: string, channel: FlowChannel, connectionId?: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { bootstrap } = useDashboardShell();
  const apiConnections = bootstrap?.channelSummary.metaApi.connections ?? [];
  const [step, setStep] = useState<"channel" | "name">("channel");
  const [channel, setChannel] = useState<FlowChannel>("api");
  const [connectionId, setConnectionId] = useState(
    () => bootstrap?.channelSummary.metaApi.connection?.id ?? apiConnections.find(isMetaConnectionActive)?.id ?? apiConnections[0]?.id ?? ""
  );
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [name, setName] = useState("Untitled Flow");
  const [aiPrompt, setAiPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    if (!name.trim()) return;
    if (channel === "api" && (!connectionId || !isMetaConnectionActive(apiConnections.find((connection) => connection.id === connectionId)))) {
      setError("Select an active WhatsApp API connection before creating this flow.");
      return;
    }
    setError(null);
    props.onCreate(name.trim(), channel, channel === "api" ? connectionId : null);
  };

  const handleGenerateWithAi = async () => {
    if (!aiPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreateWithAi(aiPrompt.trim(), channel, channel === "api" ? connectionId : null);
    } catch (err) {
      setError((err as Error).message || "Could not generate a draft flow.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fn-modal-overlay" onClick={props.onClose} />
      <div className="fn-modal">
        {step === "channel" ? (
          <>
            <div className="fn-modal-head">
              <h3>New Flow - Choose Channel</h3>
              <button className="fn-icon-btn" onClick={props.onClose}>x</button>
            </div>
            <div className="fn-modal-body">
              <p style={{ fontSize: "0.8rem", color: "var(--text-3)", marginBottom: "1rem" }}>
                Blocks and capabilities differ by channel. Choose once - it cannot be changed later.
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
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="fn-modal-head">
              <h3>New Flow - Name It</h3>
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
              {channel === "api" ? (
                <div style={{ marginBottom: "0.9rem" }}>
                  <MetaConnectionSelector
                    connections={apiConnections}
                    value={connectionId}
                    onChange={setConnectionId}
                    label="WhatsApp API connection"
                    required
                    allowEmpty
                    emptyLabel="Select a connection"
                  />
                </div>
              ) : null}
              <div className="fn-create-mode-toggle">
                <button
                  type="button"
                  className={`fn-create-mode-btn${mode === "manual" ? " active" : ""}`}
                  onClick={() => setMode("manual")}
                >
                  Start Blank
                </button>
                <button
                  type="button"
                  className={`fn-create-mode-btn${mode === "ai" ? " active" : ""}`}
                  onClick={() => setMode("ai")}
                >
                  Generate Draft with AI
                </button>
              </div>
              {mode === "manual" ? (
                <input
                  className="fn-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Flow name..."
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
              ) : (
                <div className="fn-ai-create-wrap">
                  <textarea
                    className="fn-input fn-ai-create-textarea"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe the flow you want, for example: Create a restaurant feedback flow that collects comments, thanks the customer, and escalates negative feedback to a human."
                    rows={5}
                    autoFocus
                  />
                  <p className="fn-ai-create-hint">
                    AI will create a generic draft using existing flow components and placeholders for details you still need to fill.
                  </p>
                </div>
              )}
              {error ? <div className="fn-banner fn-banner-error" style={{ marginTop: "0.75rem" }}>{error}</div> : null}
            </div>
            <div className="fn-modal-foot" style={{ display: "flex", gap: "0.5rem" }}>
              <button className="fn-btn" onClick={() => setStep("channel")}>
                Back
              </button>
              {mode === "manual" ? (
                <button
                  className="fn-btn fn-btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleCreate}
                  disabled={!name.trim()}
                >
                  Create Flow
                </button>
              ) : (
                <button
                  className="fn-btn fn-btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleGenerateWithAi}
                  disabled={!aiPrompt.trim() || busy}
                >
                  {busy ? "Generating..." : "Generate Draft"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// â”€â”€â”€ Flow list page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CHANNEL_TABS: { key: FlowChannel | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "web", label: "Web Widget" },
  { key: "qr", label: "WhatsApp QR" },
  { key: "api", label: "WhatsApp API" }
];

function FlowsPage() {
  const { token } = useDashboardShell();
  const navigate = useNavigate();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FlowChannel | "all">("all");

  useEffect(() => {
    setLoading(true);
    apiListFlows(token)
      .then((data) => setFlows(data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [token]);

  // handleCreate is now on /new sub-route

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

  const handleTogglePublish = async (flow: FlowSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!flow.published) {
      try {
        const detail = await apiGetFlow(token, flow.id);
        const validation = validateFlow(detail.channel, detail.nodes as FlowNode[], detail.edges);
        if (validation.errors.length > 0) {
          setListNotice(`"${flow.name}" cannot go live yet: ${validation.errors[0]?.message}`);
          return;
        }
      } catch (fetchError) {
        setListNotice(`Could not load "${flow.name}" before publishing: ${String(fetchError)}`);
        return;
      }
    }
    try {
      const updated = await apiPublishFlow(token, flow.id, !flow.published);
      setFlows((cur) => cur.map((f) => (f.id === flow.id ? summarizeFlow(updated) : f)));
      setListNotice(null);
    } catch (e) {
      console.error("Failed to toggle publish", e);
    }
  };

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
        <button className="fn-btn fn-btn-primary" onClick={() => navigate("new")}>
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
          <button className="fn-btn fn-btn-primary" onClick={() => navigate("new")}>
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
                  {flow.nodeCount} nodes · {flow.edgeCount} links · Updated {formatFlowDate(flow.updatedAt)}
                </div>
                <div className="fn-flow-card-actions">
                  <button
                    className={`fn-status-btn ${flow.published ? "live" : "draft"}`}
                    onClick={(e) => handleTogglePublish(flow, e)}
                    title={flow.published ? "Click to unpublish" : "Click to publish"}
                  >
                    {flow.published ? "Live" : "Draft"}
                  </button>
                  {flow.isDefaultReply && (
                    <span
                      className="fn-status-btn"
                      title="This flow is the default reply for its channel"
                      style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", cursor: "default" }}
                    >
                      Default Reply
                    </span>
                  )}
                  <button
                    className="fn-btn fn-btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => navigate(flow.id)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ Exports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// ─── Flow editor page ────────────────────────────────────────────────────────

function FlowEditorPage() {
  const { token } = useDashboardShell();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [flow, setFlow] = useState<FlowDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const aiWarnings = Array.isArray((location.state as { aiGenerationWarnings?: unknown } | null)?.aiGenerationWarnings)
    ? ((location.state as { aiGenerationWarnings?: string[] }).aiGenerationWarnings ?? [])
    : [];

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiGetFlow(token, id)
      .then((f) => setFlow(f))
      .catch((e) => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, [id, token]);

  if (loading) {
    return <div className="fn-page-center" style={{ color: "var(--text-3)", fontSize: "0.85rem" }}>Loading flow...</div>;
  }
  if (fetchError || !flow) {
    return (
      <div className="fn-page-center" style={{ flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ color: "#9f1239", fontSize: "0.85rem" }}>{fetchError ?? "Flow not found."}</div>
        <button className="fn-btn" onClick={() => navigate("/dashboard/studio/flows")}>Back to Flows</button>
      </div>
    );
  }

  return (
    <FlowEditor
      key={flow.id}
      flow={flow}
      token={token}
      initialNotice={aiWarnings.length > 0 ? aiWarnings.join(" ") : null}
      onChange={(updated) => setFlow(updated)}
      onBack={() => navigate("/dashboard/studio/flows")}
    />
  );
}

// ─── Flow new page ────────────────────────────────────────────────────────────

function FlowNewPage() {
  const { token } = useDashboardShell();
  const navigate = useNavigate();

  const handleCreate = async (name: string, channel: FlowChannel, connectionId?: string | null) => {
    try {
      const created = await apiCreateFlow(token, name, channel, { connectionId });
      navigate(`/dashboard/studio/flows/${created.id}`, { replace: true });
    } catch (e) {
      console.error("Failed to create flow", e);
    }
  };

  const handleCreateWithAi = async (prompt: string, channel: FlowChannel, connectionId?: string | null) => {
    const draft = await apiGenerateFlowDraft(token, prompt, channel);
    const created = await apiCreateFlow(token, draft.name, channel, {
      connectionId,
      nodes: draft.nodes as unknown as FlowNode[],
      edges: draft.edges,
      triggers: draft.triggers
    });
    navigate(`/dashboard/studio/flows/${created.id}`, {
      replace: true,
      state: { aiGenerationWarnings: draft.warnings }
    });
  };

  return (
    <CreateFlowModal
      onCreate={handleCreate}
      onCreateWithAi={handleCreateWithAi}
      onClose={() => navigate("/dashboard/studio/flows")}
    />
  );
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export async function prefetchData(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: DashboardModulePrefetchContext
): Promise<void> {
  return;
}

export function Component() {
  const element = useRoutes([
    { index: true, element: <FlowsPage /> },
    { path: "new", element: <FlowNewPage /> },
    { path: ":id", element: <FlowEditorPage /> }
  ]);

  return <>{element}</>;
}

