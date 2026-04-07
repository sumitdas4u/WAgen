import { useMemo, useState } from "react";
import {
  useFlowEditorVariableOptions,
  type FlowEditorVariableOption
} from "./editor-shared";

type VariableTarget = HTMLInputElement | HTMLTextAreaElement;

export function isVariableTarget(element: EventTarget | null): element is VariableTarget {
  if (typeof window === "undefined") {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled;
  }
  if (!(element instanceof HTMLInputElement)) {
    return false;
  }

  return (
    !element.readOnly &&
    !element.disabled &&
    !["checkbox", "radio", "file", "hidden", "submit", "button"].includes(element.type)
  );
}

function setInputValue(target: VariableTarget, nextValue: string) {
  const prototype =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(target, nextValue);
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

export function insertVariableToken(target: VariableTarget, token: string): boolean {
  if (!target.isConnected || target.disabled || target.readOnly) {
    return false;
  }

  const value = target.value ?? "";
  const start = target.selectionStart ?? value.length;
  const end = target.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
  const caret = start + token.length;

  setInputValue(target, nextValue);
  target.focus();
  target.setSelectionRange(caret, caret);
  return true;
}

function groupOptions(options: FlowEditorVariableOption[]) {
  const groups: Array<{ label: string; options: FlowEditorVariableOption[] }> = [
    { label: "Contact", options: options.filter((option) => option.category === "contact") },
    { label: "Custom Fields", options: options.filter((option) => option.category === "custom") },
    { label: "Flow Variables", options: options.filter((option) => option.category === "flow") }
  ];

  return groups.filter((group) => group.options.length > 0);
}

export function FlowVariablePicker(props: {
  activeTarget: VariableTarget | null;
}) {
  const { activeTarget } = props;
  const variableOptions = useFlowEditorVariableOptions();
  const [selectedToken, setSelectedToken] = useState("");
  const groupedOptions = useMemo(() => groupOptions(variableOptions), [variableOptions]);
  const canInsert = Boolean(activeTarget?.isConnected);

  return (
    <div className="fn-variable-toolbar">
      <label className="fn-variable-label">Variables</label>
      <select
        className="fn-variable-select nodrag"
        value={selectedToken}
        onChange={(event) => {
          const token = event.target.value;
          setSelectedToken("");
          if (!token || !activeTarget) {
            return;
          }
          insertVariableToken(activeTarget, token);
        }}
      >
        <option value="">
          {canInsert ? "Insert into focused field..." : "Focus a text field to insert a variable"}
        </option>
        {groupedOptions.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.id} value={option.token}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
