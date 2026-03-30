import { getNextNodeId } from "../helpers.js";
import type { FlowBlockModule } from "../types.js";

export const conditionBlock: FlowBlockModule = {
  type: "condition",
  async execute(context) {
    const variableName = String(context.node.data.variable ?? "")
      .replace(/\{\{|\}\}/g, "")
      .trim();
    const operator = String(context.node.data.operator ?? "equals");
    const expected = String(context.node.data.value ?? "");
    const actual = String(context.vars[variableName] ?? "");

    let matched = false;
    switch (operator) {
      case "equals":
        matched = actual === expected;
        break;
      case "not_equals":
        matched = actual !== expected;
        break;
      case "contains":
        matched = actual.toLowerCase().includes(expected.toLowerCase());
        break;
      case "greater":
        matched = parseFloat(actual) > parseFloat(expected);
        break;
      case "less":
        matched = parseFloat(actual) < parseFloat(expected);
        break;
      case "exists":
        matched = variableName in context.vars && context.vars[variableName] != null;
        break;
      case "not_exists":
        matched = !(variableName in context.vars) || context.vars[variableName] == null;
        break;
      default:
        matched = false;
        break;
    }

    return {
      signal: "continue",
      nextNodeId: getNextNodeId(
        context.nodes,
        context.edges,
        context.node.id,
        matched ? "true" : "false"
      ),
      variables: context.vars
    };
  }
};
