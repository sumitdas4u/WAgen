import type { ComponentType } from "react";
import type { NodeProps } from "reactflow";
import { aiAgentStudioBlock } from "./basic/ai-agent";
import { aiReplyStudioBlock } from "./basic/ai-reply";
import { apiRequestStudioBlock } from "./basic/api-request";
import { askLocationStudioBlock } from "./basic/ask-location";
import { askQuestionStudioBlock } from "./basic/ask-question";
import { conditionStudioBlock } from "./basic/condition";
import { flowStartStudioBlock } from "./basic/flow-start";
import { googleCalendarBookingStudioBlock } from "./basic/google-calendar";
import {
  googleSheetsStudioBlock,
  googleSheetsAddRowStudioBlock,
  googleSheetsFetchRowStudioBlock,
  googleSheetsFetchRowsStudioBlock,
  googleSheetsUpdateRowStudioBlock
} from "./basic/google-sheets";
import { listStudioBlock } from "./basic/list";
import { mediaButtonsStudioBlock } from "./basic/media-buttons";
import { requestInterventionStudioBlock } from "./basic/request-intervention";
import { sendContactStudioBlock } from "./basic/send-contact";
import { sendImageMenuStudioBlock } from "./basic/send-image-menu";
import { sendLocationStudioBlock } from "./basic/send-location";
import { sendMediaStudioBlock } from "./basic/send-media";
import { sendPollStudioBlock } from "./basic/send-poll";
import { sendTextMenuStudioBlock } from "./basic/send-text-menu";
import { sendTextStudioBlock } from "./basic/send-text";
import { updateContactFieldStudioBlock } from "./basic/update-contact-field";
import { templateStudioBlock } from "./basic/template";
import { textButtonsStudioBlock } from "./basic/text-buttons";
import { multiProductStudioBlock } from "./legacy/multi-product";
import { singleProductStudioBlock } from "./legacy/single-product";
import { whatsappPayStudioBlock } from "./legacy/whatsapp-pay";
import type {
  AnyNodeData,
  FlowBlockKind,
  FlowChannel,
  StudioFlowBlockDefinition,
  StudioFlowBlockSection
} from "./types";

export const studioFlowBlocks: StudioFlowBlockDefinition[] = [
  flowStartStudioBlock,
  sendTextStudioBlock,
  sendMediaStudioBlock,
  sendLocationStudioBlock,
  sendContactStudioBlock,
  updateContactFieldStudioBlock,
  sendPollStudioBlock,
  sendTextMenuStudioBlock,
  sendImageMenuStudioBlock,
  textButtonsStudioBlock,
  mediaButtonsStudioBlock,
  listStudioBlock,
  templateStudioBlock,
  askQuestionStudioBlock,
  askLocationStudioBlock,
  conditionStudioBlock,
  requestInterventionStudioBlock,
  apiRequestStudioBlock,
  aiAgentStudioBlock,
  googleCalendarBookingStudioBlock,
  googleSheetsStudioBlock,
  googleSheetsAddRowStudioBlock,
  googleSheetsUpdateRowStudioBlock,
  googleSheetsFetchRowStudioBlock,
  googleSheetsFetchRowsStudioBlock,
  aiReplyStudioBlock,
  singleProductStudioBlock,
  multiProductStudioBlock,
  whatsappPayStudioBlock
];

const blockRegistry = new Map(
  studioFlowBlocks.map((block) => [block.kind, block] as const)
);

export const studioPaletteBlocks = studioFlowBlocks.filter(
  (block) => block.catalog.availableInPalette !== false
);

export function getPaletteBlocksForChannel(channel: FlowChannel): StudioFlowBlockDefinition[] {
  return studioPaletteBlocks.filter(
    (block) => !block.channels || block.channels.includes(channel)
  );
}

export const studioBlockSections = Array.from(
  new Set(studioPaletteBlocks.map((block) => block.catalog.section))
) as StudioFlowBlockSection[];

export const studioBlockNodeTypes = Object.fromEntries(
  studioFlowBlocks.map((block) => [block.kind, block.NodeComponent])
) as Record<string, ComponentType<NodeProps<unknown>>>;

export function isStudioFlowBlockKind(value: string): value is FlowBlockKind {
  return blockRegistry.has(value as FlowBlockKind);
}

export function getStudioFlowBlock(kind: FlowBlockKind) {
  return blockRegistry.get(kind);
}

export function createDefaultBlockData(kind: FlowBlockKind): AnyNodeData {
  const block = blockRegistry.get(kind);
  if (!block) {
    throw new Error(`Unknown flow block kind: ${kind}`);
  }
  return block.createDefaultData();
}
