import { createContext, useCallback, useContext } from "react";
import { useReactFlow } from "reactflow";
import { pruneInvalidNodeEdges } from "../flow-validation";
import type { ContactField } from "../../../../../lib/api";
import type { AnyNodeData, FlowNode } from "./types";

// ─── Editor context (provides auth token to node components) ──────────────────

interface FlowEditorCtx {
  token: string;
  connectionId: string | null;
  contactFields: ContactField[];
  variableOptions: FlowEditorVariableOption[];
}

export interface FlowEditorVariableOption {
  id: string;
  label: string;
  token: string;
  category: "contact" | "custom" | "flow";
  description?: string;
}

export const FlowEditorContext = createContext<FlowEditorCtx>({
  token: "",
  connectionId: null,
  contactFields: [],
  variableOptions: []
});

export function useFlowEditorToken(): string {
  return useContext(FlowEditorContext).token;
}

export function useFlowEditorConnectionId(): string | null {
  return useContext(FlowEditorContext).connectionId;
}

export function useFlowEditorVariableOptions(): FlowEditorVariableOption[] {
  return useContext(FlowEditorContext).variableOptions;
}

export function useFlowEditorContactFields(): ContactField[] {
  return useContext(FlowEditorContext).contactFields;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function NodeHeader(props: {
  nodeId?: string;
  icon: string;
  title: string;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
}) {
  const { nodeId, icon, title, onEdit, onDuplicate, onDelete } = props;
  return (
    <div className="fn-node-header" data-node-id={nodeId}>
      <span className="fn-node-header-icon-wrap">
        <span className="fn-node-header-icon">{icon}</span>
      </span>
      <span className="fn-node-header-title">{title}</span>
      <div className="fn-node-header-actions">
        <button
          className="fn-icon-btn nodrag"
          onClick={(event) => {
            event.stopPropagation();
            onEdit?.();
          }}
          title="Edit"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="fn-icon-btn nodrag"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate?.();
          }}
          title="Duplicate"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="4" y="2" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2.5 4.5V9C2.5 9.55228 2.94772 10 3.5 10H7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <button
        className="fn-icon-btn fn-delete-btn nodrag"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1 1L10 10M10 1L1 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function useNodePatch<TData extends AnyNodeData>(id: string) {
  const { getNodes, setNodes, setEdges } = useReactFlow();

  const patch = useCallback(
    (updates: Partial<TData>, options?: { pruneInvalidEdges?: boolean }) => {
      const currentNode = getNodes().find((node) => node.id === id) as FlowNode | undefined;
      const nextData = { ...(currentNode?.data as TData | undefined), ...updates } as TData;

      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...updates } } : node
        )
      );

      if (options?.pruneInvalidEdges && currentNode) {
        setEdges((edges) =>
          pruneInvalidNodeEdges(edges, id, String(currentNode.type), nextData)
        );
      }
    },
    [getNodes, id, setEdges, setNodes]
  );

  const selectNode = useCallback(() => {
    setNodes((nodes) =>
      nodes.map((node) => ({ ...node, selected: node.id === id }))
    );
  }, [id, setNodes]);

  const duplicateNode = useCallback(() => {
    const currentNode = getNodes().find((node) => node.id === id) as FlowNode | undefined;
    if (!currentNode) {
      return;
    }

    const cloneData = JSON.parse(JSON.stringify(currentNode.data)) as TData;
    const nextNodeId = uid();

    setNodes((nodes) => [
      ...nodes.map((node) => ({ ...node, selected: false })),
      {
        ...currentNode,
        id: nextNodeId,
        position: {
          x: currentNode.position.x + 48,
          y: currentNode.position.y + 48
        },
        data: cloneData,
        selected: true
      }
    ]);
  }, [getNodes, id, setNodes]);

  const removeNode = useCallback(() => {
    setNodes((nodes) => nodes.filter((node) => node.id !== id));
    setEdges((edges) => edges.filter((edge) => edge.source !== id && edge.target !== id));
  }, [id, setEdges, setNodes]);

  return { patch, del: removeNode, duplicate: duplicateNode, edit: selectNode };
}
