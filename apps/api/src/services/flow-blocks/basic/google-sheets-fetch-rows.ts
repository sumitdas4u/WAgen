import { fetchFirstMatchedGoogleSheetRows } from "../../google-sheets-service.js";
import type { FlowBlockModule } from "../types.js";
import {
  buildGoogleSheetsFailureResult,
  buildGoogleSheetsSuccessResult,
  readGoogleSheetsCommon,
  readGoogleSheetsReference
} from "./google-sheets-shared.js";

export const googleSheetsFetchRowsBlock: FlowBlockModule = {
  type: "googleSheetsFetchRows",
  async execute(context) {
    const common = readGoogleSheetsCommon(context);
    const reference = readGoogleSheetsReference(context);

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
        return buildGoogleSheetsFailureResult(
          context,
          common.saveAs,
          "not_found",
          "No matching Google Sheets rows were found.",
          result,
          {
            [`${common.saveAs}_rows`]: [],
            [`${common.saveAs}_count`]: 0
          }
        );
      }

      return buildGoogleSheetsSuccessResult(context, common.saveAs, "found", result, {
        [`${common.saveAs}_rows`]: result.rows,
        [`${common.saveAs}_count`]: result.count
      });
    } catch (error) {
      return buildGoogleSheetsFailureResult(
        context,
        common.saveAs,
        "request_failed",
        (error as Error).message,
        undefined,
        {
          [`${common.saveAs}_rows`]: [],
          [`${common.saveAs}_count`]: 0
        }
      );
    }
  }
};
