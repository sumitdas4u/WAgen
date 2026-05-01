import { useEffect, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, useFlowEditorConnectionId, useFlowEditorToken, useNodePatch } from "../editor-shared";
import { MediaUpload } from "../media-upload";
import { useTemplatesQuery } from "../../../../templates/queries";
import type { StudioFlowBlockDefinition, TemplateData } from "../types";

function TemplateNode({ id, data, selected }: NodeProps<TemplateData>) {
  const { patch, del } = useNodePatch<TemplateData>(id);
  const token = useFlowEditorToken();
  const connectionId = useFlowEditorConnectionId();

  const templatesQuery = useTemplatesQuery(token, { connectionId });

  const matchedTemplate = useMemo(() => {
    if (!templatesQuery.data || !data.templateName) return null;
    return templatesQuery.data.find(
      (t) => t.name.toLowerCase() === data.templateName.toLowerCase()
    ) ?? null;
  }, [templatesQuery.data, data.templateName]);

  const headerMediaType = useMemo(() => {
    const header = matchedTemplate?.components.find((c) => c.type === "HEADER");
    const fmt = header?.format;
    return fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT" ? fmt : null;
  }, [matchedTemplate]);

  const mediaTypeLabel = headerMediaType ? headerMediaType.toLowerCase() as "image" | "video" | "document" : null;

  useEffect(() => {
    patch({ headerMediaType: mediaTypeLabel ?? undefined });
  }, [mediaTypeLabel]); // intentionally omit patch — stable ref from useNodePatch

  // Pre-fill headerMediaUrl from template default when template is selected and no override set
  useEffect(() => {
    const defaultUrl = matchedTemplate?.headerMediaUrl ?? null;
    if (defaultUrl && !data.headerMediaUrl) {
      patch({ headerMediaUrl: defaultUrl });
    }
  }, [matchedTemplate?.headerMediaUrl]); // intentionally omit patch and data.headerMediaUrl — one-time pre-fill

  return (
    <div className={`fn-node fn-node-template${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📄" title="Template" onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">TEMPLATE NAME</label>
          <input
            className="fn-node-input nodrag"
            value={data.templateName}
            onChange={(event) => patch({ templateName: event.target.value })}
            placeholder="my_template_name"
          />
        </div>
        <div className="fn-node-field">
          <label className="fn-node-label">LANGUAGE</label>
          <select
            className="fn-node-select nodrag"
            value={data.language}
            onChange={(event) => patch({ language: event.target.value })}
          >
            <option value="en">English (en)</option>
            <option value="en_US">English US</option>
            <option value="hi">Hindi (hi)</option>
            <option value="es">Spanish (es)</option>
            <option value="pt_BR">Portuguese (pt_BR)</option>
            <option value="ar">Arabic (ar)</option>
          </select>
        </div>
        {mediaTypeLabel ? (
          <div className="fn-node-field">
            <label className="fn-node-label">HEADER {headerMediaType}</label>
            {matchedTemplate?.headerMediaUrl && data.headerMediaUrl === matchedTemplate.headerMediaUrl ? (
              <div style={{ fontSize: "11px", color: "#16a34a", marginBottom: "4px" }}>✓ Using template default</div>
            ) : !data.headerMediaUrl ? (
              <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>Optional — leave empty to use the approved image.</div>
            ) : null}
            <MediaUpload
              mediaType={mediaTypeLabel}
              currentUrl={data.headerMediaUrl}
              onUrl={(url) => patch({ headerMediaUrl: url })}
            />
            {matchedTemplate?.headerMediaUrl && data.headerMediaUrl && data.headerMediaUrl !== matchedTemplate.headerMediaUrl ? (
              <button
                type="button"
                className="nodrag"
                onClick={() => patch({ headerMediaUrl: matchedTemplate.headerMediaUrl ?? "" })}
                style={{ fontSize: "10px", color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginTop: "2px" }}
              >
                ↩ Reset to template default
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const templateStudioBlock: StudioFlowBlockDefinition<TemplateData> = {
  kind: "template",
  channels: ["api"],
  catalog: {
    kind: "template",
    icon: "📄",
    name: "Template",
    desc: "Send approved template",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "template",
      templateName: "",
      language: "en",
      headerMediaUrl: ""
    };
  },
  NodeComponent: TemplateNode
};
