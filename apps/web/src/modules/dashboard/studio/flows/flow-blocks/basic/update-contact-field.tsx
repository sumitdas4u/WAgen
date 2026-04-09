import { useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  NodeHeader,
  useFlowEditorContactFields,
  useNodePatch
} from "../editor-shared";
import type {
  StudioFlowBlockDefinition,
  UpdateContactFieldData,
  UpdateContactFieldOperation
} from "../types";

type ContactFieldChoice = {
  key: string;
  label: string;
  fieldType?: string;
};

const BUILT_IN_FIELDS: ContactFieldChoice[] = [
  { key: "name", label: "Contact Name", fieldType: "TEXT" },
  { key: "email", label: "Email", fieldType: "TEXT" },
  { key: "phone", label: "Phone", fieldType: "TEXT" },
  { key: "type", label: "Contact Type", fieldType: "TEXT" },
  { key: "tags", label: "Tags", fieldType: "MULTI_TEXT" },
  { key: "source", label: "Source", fieldType: "TEXT" },
  { key: "source_id", label: "Source ID", fieldType: "TEXT" },
  { key: "source_url", label: "Source URL", fieldType: "TEXT" }
];

const CONTACT_TYPE_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "feedback", label: "Feedback" },
  { value: "complaint", label: "Complaint" },
  { value: "other", label: "Other" }
];

const OPERATION_META: Array<{ value: UpdateContactFieldOperation; label: string }> = [
  { value: "replace", label: "Replace" },
  { value: "append", label: "Append" },
  { value: "add_if_empty", label: "Add If Empty" }
];

function getAvailableOperations(fieldType?: string): UpdateContactFieldOperation[] {
  if (fieldType === "MULTI_TEXT") {
    return ["replace", "append", "add_if_empty"];
  }
  return ["replace", "add_if_empty"];
}

function getFieldLabel(fieldKey: string, choices: ContactFieldChoice[]): string {
  return choices.find((choice) => choice.key === fieldKey)?.label ?? "Contact Field";
}

function formatValuePreview(data: UpdateContactFieldData, fieldType?: string): string {
  if (!data.value.trim()) {
    return "No value";
  }
  if (data.fieldKey === "type" && !data.dynamicValue) {
    return CONTACT_TYPE_OPTIONS.find((option) => option.value === data.value)?.label ?? data.value;
  }
  if (fieldType === "MULTI_TEXT") {
    return data.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .join(", ");
  }
  return data.value.trim();
}

function UpdateContactFieldNode({ id, data, selected }: NodeProps<UpdateContactFieldData>) {
  const { patch, del, duplicate, edit } = useNodePatch<UpdateContactFieldData>(id);
  const contactFields = useFlowEditorContactFields();

  const fieldChoices = useMemo(
    () => [
      ...BUILT_IN_FIELDS,
      ...contactFields
        .filter((field) => field.is_active)
        .map((field) => ({
          key: `custom.${field.name}`,
          label: field.label,
          fieldType: field.field_type
        }))
    ],
    [contactFields]
  );

  const selectedField = fieldChoices.find((choice) => choice.key === data.fieldKey) ?? fieldChoices[0];
  const operations = getAvailableOperations(selectedField?.fieldType);
  const nextOperation = operations.includes(data.operation) ? data.operation : "replace";
  const valuePreview = formatValuePreview(data, selectedField?.fieldType);

  return (
    <div className={`fn-node fn-node-updateContactField${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader
        nodeId={id}
        icon="👥"
        title="Update Contact Field"
        onEdit={edit}
        onDuplicate={duplicate}
        onDelete={del}
      />
      <div className="fn-node-body">
        <div className="fn-node-field">
          <label className="fn-node-label">FIELD NAME</label>
          <select
            className="fn-node-select nodrag"
            value={selectedField?.key ?? ""}
            onChange={(event) => {
              const nextField = fieldChoices.find((choice) => choice.key === event.target.value);
              const allowedOperations = getAvailableOperations(nextField?.fieldType);
              patch({
                fieldKey: event.target.value,
                operation: allowedOperations.includes(data.operation) ? data.operation : "replace"
              });
            }}
          >
            {fieldChoices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <label className="fn-node-check">
          <input
            type="checkbox"
            checked={data.dynamicValue}
            onChange={(event) => patch({ dynamicValue: event.target.checked })}
          />
          <span>Dynamic Value</span>
        </label>

        <div className="fn-node-field">
          <label className="fn-node-label">VALUE</label>
          {data.fieldKey === "type" && !data.dynamicValue ? (
            <select
              className="fn-node-select nodrag"
              value={data.value}
              onChange={(event) => patch({ value: event.target.value })}
            >
              {CONTACT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="fn-node-input nodrag"
              value={data.value}
              onChange={(event) => patch({ value: event.target.value })}
              placeholder={
                data.dynamicValue
                  ? "Use {{variable}} from previous blocks"
                  : selectedField?.fieldType === "MULTI_TEXT"
                    ? "vip, warm lead"
                    : "Enter a value"
              }
            />
          )}
        </div>

        <div className="fn-node-field">
          <label className="fn-node-label">OPERATION</label>
          <div className="fn-op-group">
            {OPERATION_META.filter((option) => operations.includes(option.value)).map((option) => (
              <label key={option.value} className="fn-op-pill">
                <input
                  type="radio"
                  name={`update-contact-field-op-${id}`}
                  checked={nextOperation === option.value}
                  onChange={() => patch({ operation: option.value })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="fn-node-summary">
          {getFieldLabel(data.fieldKey, fieldChoices)} will be {nextOperation.replace(/_/g, " ")} with "{valuePreview}".
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="fn-handle-out" />
    </div>
  );
}

export const updateContactFieldStudioBlock: StudioFlowBlockDefinition<UpdateContactFieldData> = {
  kind: "updateContactField",
  channels: ["web", "qr", "api"],
  catalog: {
    kind: "updateContactField",
    icon: "👥",
    name: "Update Contact Field",
    desc: "Update tags, name, email, and custom contact fields",
    section: "Actions",
    availableInPalette: true,
    status: "active"
  },
  createDefaultData() {
    return {
      kind: "updateContactField",
      fieldKey: "name",
      value: "",
      dynamicValue: false,
      operation: "replace"
    };
  },
  NodeComponent: UpdateContactFieldNode
};
