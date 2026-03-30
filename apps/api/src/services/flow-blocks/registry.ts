import type { FlowBlockModule } from "./types.js";
import { aiReplyBlock } from "./basic/ai-reply.js";
import { aiAgentBlock } from "./basic/ai-agent.js";
import { apiRequestBlock } from "./basic/api-request.js";
import { askLocationBlock } from "./basic/ask-location.js";
import { askQuestionBlock } from "./basic/ask-question.js";
import { conditionBlock } from "./basic/condition.js";
import { flowStartBlock } from "./basic/flow-start.js";
import { googleCalendarBookingBlock } from "./basic/google-calendar-booking.js";
import { googleSheetsBlock } from "./basic/google-sheets.js";
import { googleSheetsAddRowBlock } from "./basic/google-sheets-add-row.js";
import { googleSheetsFetchRowBlock } from "./basic/google-sheets-fetch-row.js";
import { googleSheetsFetchRowsBlock } from "./basic/google-sheets-fetch-rows.js";
import { googleSheetsUpdateRowBlock } from "./basic/google-sheets-update-row.js";
import { listBlock } from "./basic/list.js";
import { mediaButtonsBlock } from "./basic/media-buttons.js";
import { requestInterventionBlock } from "./basic/request-intervention.js";
import { sendContactBlock } from "./basic/send-contact.js";
import { sendImageMenuBlock } from "./basic/send-image-menu.js";
import { sendLocationBlock } from "./basic/send-location.js";
import { sendMediaBlock } from "./basic/send-media.js";
import { sendPollBlock } from "./basic/send-poll.js";
import { sendTextBlock } from "./basic/send-text.js";
import { sendTextMenuBlock } from "./basic/send-text-menu.js";
import { templateBlock } from "./basic/template.js";
import { textButtonsBlock } from "./basic/text-buttons.js";
import { multiProductBlock } from "./legacy/multi-product.js";
import { singleProductBlock } from "./legacy/single-product.js";
import { whatsappPayBlock } from "./legacy/whatsapp-pay.js";

const blockModules: FlowBlockModule[] = [
  flowStartBlock,
  sendTextBlock,
  sendMediaBlock,
  sendLocationBlock,
  sendContactBlock,
  sendPollBlock,
  sendTextMenuBlock,
  sendImageMenuBlock,
  textButtonsBlock,
  mediaButtonsBlock,
  listBlock,
  templateBlock,
  askQuestionBlock,
  askLocationBlock,
  conditionBlock,
  requestInterventionBlock,
  apiRequestBlock,
  aiAgentBlock,
  googleCalendarBookingBlock,
  googleSheetsBlock,
  googleSheetsAddRowBlock,
  googleSheetsUpdateRowBlock,
  googleSheetsFetchRowBlock,
  googleSheetsFetchRowsBlock,
  aiReplyBlock,
  singleProductBlock,
  multiProductBlock,
  whatsappPayBlock
];

const registry = new Map(blockModules.map((module) => [module.type, module]));

export function getFlowBlockModule(type: string): FlowBlockModule | null {
  return registry.get(type) ?? null;
}
