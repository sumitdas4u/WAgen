import { appendGoogleSheetRow } from "../../google-sheets-service.js";
import type { FlowBlockModule } from "../types.js";
import {
  buildGoogleSheetsFailureResult,
  buildGoogleSheetsSuccessResult,
  readGoogleSheetsCommon,
  readGoogleSheetsRowValues
} from "./google-sheets-shared.js";

export const googleSheetsAddRowBlock: FlowBlockModule = {
  type: "googleSheetsAddRow",
  async execute(context) {
    const common = readGoogleSheetsCommon(context);

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
      return buildGoogleSheetsFailureResult(
        context,
        common.saveAs,
        "request_failed",
        (error as Error).message
      );
    }
  }
};
