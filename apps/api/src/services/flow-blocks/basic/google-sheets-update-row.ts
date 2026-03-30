import { updateGoogleSheetRow } from "../../google-sheets-service.js";
import type { FlowBlockModule } from "../types.js";
import {
  buildGoogleSheetsFailureResult,
  buildGoogleSheetsSuccessResult,
  readGoogleSheetsCommon,
  readGoogleSheetsReference,
  readGoogleSheetsRowValues
} from "./google-sheets-shared.js";

export const googleSheetsUpdateRowBlock: FlowBlockModule = {
  type: "googleSheetsUpdateRow",
  async execute(context) {
    const common = readGoogleSheetsCommon(context);
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
        return buildGoogleSheetsFailureResult(
          context,
          common.saveAs,
          "not_found",
          "No matching Google Sheets row was found.",
          result
        );
      }

      return buildGoogleSheetsSuccessResult(context, common.saveAs, "updated", result, {
        [`${common.saveAs}_row`]: result.row
      });
    } catch (error) {
      return buildGoogleSheetsFailureResult(
        context,
        common.saveAs,
        "request_failed",
        (error as Error).message
      );
    }
  }
};
