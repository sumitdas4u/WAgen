import { Handle, Position, type NodeProps } from "reactflow";
import { NodeHeader, uid, useNodePatch } from "../editor-shared";
import type { ListData, ListRow, StudioFlowBlockDefinition } from "../types";

function ListNode({ id, data, selected }: NodeProps<ListData>) {
  const { patch, del } = useNodePatch<ListData>(id);

  const addSection = () =>
    patch({
      sections: [...data.sections, { id: uid(), title: "Section", rows: [] }]
    });

  const addRow = (sectionId: string) =>
    patch({
      sections: data.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              rows: [
                ...section.rows,
                { id: uid(), title: "Item", description: "" }
              ]
            }
          : section
      )
    });

  const patchRow = (
    sectionId: string,
    rowId: string,
    updates: Partial<ListRow>
  ) =>
    patch({
      sections: data.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              rows: section.rows.map((row) =>
                row.id === rowId ? { ...row, ...updates } : row
              )
            }
          : section
      )
    });

  const removeRow = (sectionId: string, rowId: string) =>
    patch(
      {
        sections: data.sections.map((section) =>
          section.id === sectionId
            ? { ...section, rows: section.rows.filter((row) => row.id !== rowId) }
            : section
        )
      },
      { pruneInvalidEdges: true }
    );

  return (
    <div className={`fn-node fn-node-list${selected ? " selected" : ""}`} style={{ maxWidth: 300 }}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📋" title="List" onDelete={del} />
      <div className="fn-node-body">
        <textarea
          className="fn-node-textarea nodrag"
          value={data.message}
          onChange={(event) => patch({ message: event.target.value })}
          placeholder="List message..."
          rows={2}
        />
        <input
          className="fn-node-input nodrag"
          value={data.buttonLabel}
          onChange={(event) => patch({ buttonLabel: event.target.value })}
          placeholder="Button label"
        />
        {data.sections.map((section) => (
          <div key={section.id} className="fn-list-section">
            <input
              className="fn-node-input nodrag"
              value={section.title}
              onChange={(event) =>
                patch({
                  sections: data.sections.map((current) =>
                    current.id === section.id
                      ? { ...current, title: event.target.value }
                      : current
                  )
                })
              }
              placeholder="Section title"
              style={{ fontWeight: 700, fontSize: "0.72rem" }}
            />
            {section.rows.map((row) => (
              <div key={row.id} className="fn-list-row">
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <input
                    className="fn-list-row-input nodrag"
                    value={row.title}
                    onChange={(event) =>
                      patchRow(section.id, row.id, { title: event.target.value })
                    }
                    placeholder="Row title"
                  />
                  <input
                    className="fn-list-row-input nodrag"
                    value={row.description}
                    onChange={(event) =>
                      patchRow(section.id, row.id, { description: event.target.value })
                    }
                    placeholder="Description (optional)"
                    style={{ fontSize: "0.66rem", color: "var(--text-3)" }}
                  />
                </div>
                <button className="fn-icon-btn nodrag" onClick={() => removeRow(section.id, row.id)}>
                  x
                </button>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={row.id}
                  className="fn-handle-out"
                  style={{ position: "absolute", right: -7, top: "50%" }}
                />
              </div>
            ))}
            <button className="fn-add-btn nodrag" onClick={() => addRow(section.id)}>
              + Row
            </button>
          </div>
        ))}
        <button className="fn-add-btn nodrag" onClick={addSection}>
          + Section
        </button>
      </div>
    </div>
  );
}

export const listStudioBlock: StudioFlowBlockDefinition<ListData> = {
  kind: "list",
  channels: ["api"],
  catalog: {
    kind: "list",
    icon: "📋",
    name: "List",
    desc: "Interactive list menu",
    section: "Messages",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "list",
      message: "Please choose:",
      buttonLabel: "View Options",
      sections: [
        {
          id: uid(),
          title: "Options",
          rows: [{ id: uid(), title: "Item 1", description: "" }]
        }
      ]
    };
  },
  NodeComponent: ListNode
};
