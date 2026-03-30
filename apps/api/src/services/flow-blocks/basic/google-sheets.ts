import {
  appendGoogleSheetRow,
  fetchFirstMatchedGoogleSheetRows,
  fetchGoogleSheetRow,
  updateGoogleSheetRow
} from "../../google-sheets-service.js";
import type { FlowBlockModule } from "../types.js";
import {
  buildGoogleSheetsFailureResult,
  buildGoogleSheetsSuccessResult,
  readGoogleSheetsCommon,
  readGoogleSheetsReference,
  readGoogleSheetsRowValues
} from "./google-sheets-shared.js";
import type { FlowVariables } from "../types.js";

type GoogleSheetsOperation = "addRow" | "updateRow" | "fetchRow" | "fetchRows";

interface FetchMappingItem {
  key?: unknown;
  value?: unknown;
}

function readFetchMappings(context: Parameters<typeof readGoogleSheetsCommon>[0]): Array<{ column: string; varName: string }> {
  const raw = Array.isArray(context.node.data.fetchMappings) ? context.node.data.fetchMappings : [];
  return (raw as FetchMappingItem[])
    .map((item) => ({
      column: String(item.key ?? "").trim(),
      varName: String(item.value ?? "").trim()
    }))
    .filter((m) => m.column && m.varName);
}

function applyFetchMappings(
  mappings: Array<{ column: string; varName: string }>,
  row: Record<string, unknown> | null | undefined
): FlowVariables {
  if (!row || mappings.length === 0) return {};
  const extra: FlowVariables = {};
  for (const m of mappings) {
    if (Object.prototype.hasOwnProperty.call(row, m.column)) {
      extra[m.varName] = row[m.column];
    }
  }
  return extra;
}

export const googleSheetsBlock: FlowBlockModule = {
  type: "googleSheets",
  async execute(context) {
    const common = readGoogleSheetsCommon(context);
    const operation = (String(context.node.data.operation ?? "addRow")) as GoogleSheetsOperation;

    // ── Add Row ─────────────────────────────────────────────────────────────
    if (operation === "addRow") {
      try {
        const result = await appendGoogleSheetRow({
          userId: common.userId,
          connectionId: common.connectionId,
          spreadsheetId: common.spreadsheetId,
          sheetTitle: common.sheetTitle,
          rowValues: readGoogleSheetsRowValues(context)
        });
        return buildGoogleSheetsSuccessResult(context, common.saveAs, "appended", result, {
          [`${common.saveAs}_row`]: result.row
        });
      } catch (error) {
        return buildGoogleSheetsFailureResult(context, common.saveAs, "request_failed", (error as Error).message);
      }
    }

    // ── Update Row ───────────────────────────────────────────────────────────
    if (operation === "updateRow") {
      const reference = readGoogleSheetsReference(context);
      try {
        const result = await updateGoogleSheetRow({
          userId: common.userId,
          connectionId: common.connectionId,
          spreadsheetId: common.spreadsheetId,
          sheetTitle: common.sheetTitle,
          referenceColumn: reference.referenceColumn,
          referenceValue: reference.referenceValue,
          rowValues: readGoogleSheetsRowValues(context)
        });
        if (!result.matched) {
          return buildGoogleSheetsFailureResult(context, common.saveAs, "not_found", "No matching row was found.", result);
        }
        return buildGoogleSheetsSuccessResult(context, common.saveAs, "updated", result, {
          [`${common.saveAs}_row`]: result.row
        });
      } catch (error) {
        return buildGoogleSheetsFailureResult(context, common.saveAs, "request_failed", (error as Error).message);
      }
    }

    // ── Fetch Row ────────────────────────────────────────────────────────────
    if (operation === "fetchRow") {
      const reference = readGoogleSheetsReference(context);
      const mappings = readFetchMappings(context);
      try {
        const result = await fetchGoogleSheetRow({
          userId: common.userId,
          connectionId: common.connectionId,
          spreadsheetId: common.spreadsheetId,
          sheetTitle: common.sheetTitle,
          referenceColumn: reference.referenceColumn,
          referenceValue: reference.referenceValue
        });
        if (!result.found) {
          return buildGoogleSheetsFailureResult(context, common.saveAs, "not_found", "No matching row was found.", result, {
            [`${common.saveAs}_row`]: null
          });
        }
        return buildGoogleSheetsSuccessResult(context, common.saveAs, "found", result, {
          [`${common.saveAs}_row`]: result.row,
          ...applyFetchMappings(mappings, result.row as Record<string, unknown>)
        });
      } catch (error) {
        return buildGoogleSheetsFailureResult(context, common.saveAs, "request_failed", (error as Error).message, undefined, {
          [`${common.saveAs}_row`]: null
        });
      }
    }

    // ── Fetch Top 10 Rows ────────────────────────────────────────────────────
    if (operation === "fetchRows") {
      const reference = readGoogleSheetsReference(context);
      const mappings = readFetchMappings(context);
      try {
        const result = await fetchFirstMatchedGoogleSheetRows({
          userId: common.userId,
          connectionId: common.connectionId,
          spreadsheetId: common.spreadsheetId,
          sheetTitle: common.sheetTitle,
          referenceColumn: reference.referenceColumn,
          referenceValue: reference.referenceValue
        });
        if (!result.found) {
          return buildGoogleSheetsFailureResult(context, common.saveAs, "not_found", "No matching rows were found.", result, {
            [`${common.saveAs}_rows`]: [],
            [`${common.saveAs}_count`]: 0
          });
        }
        const firstRow = Array.isArray(result.rows) && result.rows.length > 0 ? result.rows[0] : null;
        return buildGoogleSheetsSuccessResult(context, common.saveAs, "found", result, {
          [`${common.saveAs}_rows`]: result.rows,
          [`${common.saveAs}_count`]: result.count,
          ...applyFetchMappings(mappings, firstRow as Record<string, unknown>)
        });
      } catch (error) {
        return buildGoogleSheetsFailureResult(context, common.saveAs, "request_failed", (error as Error).message, undefined, {
          [`${common.saveAs}_rows`]: [],
          [`${common.saveAs}_count`]: 0
        });
      }
    }

    // Fallback (shouldn't happen)
    return buildGoogleSheetsFailureResult(context, common.saveAs, "invalid_operation", `Unknown operation: ${operation}`);
  }
};
