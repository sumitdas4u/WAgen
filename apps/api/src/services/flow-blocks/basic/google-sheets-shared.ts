import { getNextNodeId, interpolate } from "../helpers.js";
import type { FlowBlockExecutionContext, FlowVariables } from "../types.js";

export interface GoogleSheetsRuntimeCommon {
  userId: string;
  connectionId: string | null;
  spreadsheetId: string;
  sheetTitle: string;
  saveAs: string;
}

export interface GoogleSheetsRuntimeRowValue {
  columnName: string;
  value: string;
}

function normalizeVariableName(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\{\{|\}\}/g, "")
    .trim()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

export function readGoogleSheetsCommon(
  context: FlowBlockExecutionContext
): GoogleSheetsRuntimeCommon {
  const userId = context.userId?.trim();
  if (!userId) {
    throw new Error("Google Sheets blocks require an authenticated workspace user.");
  }

  return {
    userId,
    connectionId: String(context.node.data.connectionId ?? "").trim() || null,
    spreadsheetId: String(context.node.data.spreadsheetId ?? "").trim(),
    sheetTitle: String(context.node.data.sheetTitle ?? "").trim(),
    saveAs: normalizeVariableName(context.node.data.saveAs, "google_sheets")
  };
}

export function readGoogleSheetsReference(context: FlowBlockExecutionContext): {
  referenceColumn: string;
  referenceValue: string;
} {
  return {
    referenceColumn: String(context.node.data.referenceColumn ?? "").trim(),
    referenceValue: interpolate(String(context.node.data.referenceValue ?? ""), context.vars).trim()
  };
}

export function readGoogleSheetsRowValues(
  context: FlowBlockExecutionContext
): GoogleSheetsRuntimeRowValue[] {
  const rawValues = Array.isArray(context.node.data.rowValues) ? context.node.data.rowValues : [];
  return rawValues
    .map((item) => {
      const row = (item ?? {}) as {
        key?: unknown;
        columnName?: unknown;
        value?: unknown;
      };
      return {
        columnName: String(row.columnName ?? row.key ?? "").trim(),
        value: interpolate(String(row.value ?? ""), context.vars)
      };
    })
    .filter((item) => item.columnName);
}

export function buildGoogleSheetsSuccessResult(
  context: FlowBlockExecutionContext,
  saveAs: string,
  status: string,
  payload: unknown,
  extraVariables?: FlowVariables
) {
  return {
    signal: "continue" as const,
    nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "success"),
    variables: {
      ...context.vars,
      [saveAs]: JSON.stringify(payload),
      [`${saveAs}_ok`]: true,
      [`${saveAs}_status`]: status,
      [`${saveAs}_error`]: "",
      [`${saveAs}_payload`]: payload,
      ...(extraVariables ?? {})
    }
  };
}

export function buildGoogleSheetsFailureResult(
  context: FlowBlockExecutionContext,
  saveAs: string,
  status: string,
  errorMessage: string,
  payload?: unknown,
  extraVariables?: FlowVariables
) {
  const failurePayload = payload ?? { error: errorMessage };
  return {
    signal: "continue" as const,
    nextNodeId: getNextNodeId(context.nodes, context.edges, context.node.id, "fail"),
    variables: {
      ...context.vars,
      [saveAs]: JSON.stringify(failurePayload),
      [`${saveAs}_ok`]: false,
      [`${saveAs}_status`]: status,
      [`${saveAs}_error`]: errorMessage,
      [`${saveAs}_payload`]: failurePayload,
      ...(extraVariables ?? {})
    }
  };
}
