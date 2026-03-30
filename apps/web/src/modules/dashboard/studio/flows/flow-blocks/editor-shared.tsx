import { createContext, useCallback, useContext } from "react";
import { useReactFlow } from "reactflow";
import { pruneInvalidNodeEdges } from "../flow-validation";
import type { AnyNodeData, FlowNode } from "./types";

// ─── Editor context (provides auth token to node components) ──────────────────

interface FlowEditorCtx {
  token: string;
}

export const FlowEditorContext = createContext<FlowEditorCtx>({ token: "" });

export function useFlowEditorToken(): string {
  return useContext(FlowEditorContext).token;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function NodeHeader(props: {
  icon: string;
  title: string;
  onDelete: () => void;
}) {
  const { icon, title, onDelete } = props;
  return (
    <div className="fn-node-header">
      <span className="fn-node-header-icon">{icon}</span>
      <span style={{ flex: 1, fontSize: "0.82rem" }}>{title}</span>
      <button
        className="fn-icon-btn nodrag"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        x
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

  const removeNode = useCallback(() => {
    setNodes((nodes) => nodes.filter((node) => node.id !== id));
    setEdges((edges) => edges.filter((edge) => edge.source !== id && edge.target !== id));
  }, [id, setEdges, setNodes]);

  return { patch, del: removeNode };
}
