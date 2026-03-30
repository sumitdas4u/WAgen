import { fetchGoogleSheetRow } from "../../google-sheets-service.js";
import type { FlowBlockModule } from "../types.js";
import {
  buildGoogleSheetsFailureResult,
  buildGoogleSheetsSuccessResult,
  readGoogleSheetsCommon,
  readGoogleSheetsReference
} from "./google-sheets-shared.js";

export const googleSheetsFetchRowBlock: FlowBlockModule = {
  type: "googleSheetsFetchRow",
  async execute(context) {
    const common = readGoogleSheetsCommon(context);
    const reference = readGoogleSheetsReference(context);

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
        return buildGoogleSheetsFailureResult(
          context,
          common.saveAs,
          "not_found",
          "No matching Google Sheets row was found.",
          result,
          {
            [`${common.saveAs}_row`]: null
          }
        );
      }

      return buildGoogleSheetsSuccessResult(context, common.saveAs, "found", result, {
        [`${common.saveAs}_row`]: result.row
      });
    } catch (error) {
      return buildGoogleSheetsFailureResult(
        context,
        common.saveAs,
        "request_failed",
        (error as Error).message,
        undefined,
        {
          [`${common.saveAs}_row`]: null
        }
      );
    }
  }
};
