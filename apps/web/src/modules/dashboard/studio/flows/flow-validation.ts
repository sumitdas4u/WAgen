import type { Connection } from "reactflow";
import type {
  AnyNodeData,
  FlowChannel,
  FlowEdge,
  FlowNode
} from "./flow-blocks/types";

interface NodeHandleSpec {
  source: Set<string>;
  target: Set<string>;
}

export interface FlowValidationIssue {
  id: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface FlowValidationResult {
  errors: FlowValidationIssue[];
  warnings: FlowValidationIssue[];
}

const CHANNEL_LABELS: Record<FlowChannel, string> = {
  web: "Web Widget",
  qr: "WhatsApp QR",
  api: "WhatsApp API"
};

const BLOCK_CHANNELS: Record<AnyNodeData["kind"], FlowChannel[]> = {
  aiAgent: ["web", "qr", "api"],
  aiReply: ["web", "qr", "api"],
  apiRequest: ["web", "qr", "api"],
  askLocation: ["qr", "api"],
  askQuestion: ["web", "qr", "api"],
  condition: ["web", "qr", "api"],
  flowStart: ["web", "qr", "api"],
  googleCalendarBooking: ["web", "qr", "api"],
  googleSheets: ["web", "qr", "api"],
  googleSheetsAddRow: ["web", "qr", "api"],
  googleSheetsFetchRow: ["web", "qr", "api"],
  googleSheetsFetchRows: ["web", "qr", "api"],
  googleSheetsUpdateRow: ["web", "qr", "api"],
  list: ["api"],
  mediaButtons: ["api"],
  multiProduct: ["api"],
  requestIntervention: ["web", "qr", "api"],
  sendContact: ["qr"],
  sendImageMenu: ["qr"],
  sendLocation: ["qr", "api"],
  sendMedia: ["qr", "api"],
  sendPoll: ["qr"],
  sendText: ["web", "qr", "api"],
  sendTextMenu: ["qr"],
  singleProduct: ["api"],
  template: ["api"],
  textButtons: ["api"],
  whatsappPay: ["api"]
};

function toSpec(source: string[], target: string[]): NodeHandleSpec {
  return {
    source: new Set(source),
    target: new Set(target)
  };
}

function getDynamicSourceHandles(data: AnyNodeData): string[] {
  switch (data.kind) {
    case "sendTextMenu":
    case "sendImageMenu":
      return data.options.map((option) => option.id);
    case "textButtons":
    case "mediaButtons":
      return data.buttons.map((button) => button.id);
    case "list":
      return data.sections.flatMap((section) => section.rows.map((row) => row.id));
    default:
      return [];
  }
}

function getNodeHandleSpec(nodeType: string, data: AnyNodeData): NodeHandleSpec {
  switch (data.kind) {
    case "flowStart":
      return toSpec(["out"], []);
    case "condition":
      return toSpec(["true", "false"], ["in"]);
    case "whatsappPay":
      return toSpec(["success", "fail"], ["in"]);
    case "aiAgent":
    case "apiRequest":
    case "googleCalendarBooking":
    case "googleSheets":
    case "googleSheetsAddRow":
    case "googleSheetsUpdateRow":
    case "googleSheetsFetchRow":
    case "googleSheetsFetchRows":
      return toSpec(
        data.kind === "googleCalendarBooking"
          ? ["success", "cancelled", "fail"]
          : ["success", "fail"],
        ["in"]
      );
    case "requestIntervention":
      return toSpec([], ["in"]);
    case "aiReply":
      return toSpec(data.mode === "ongoing" ? [] : ["out"], ["in"]);
    case "sendTextMenu":
    case "sendImageMenu":
    case "textButtons":
    case "mediaButtons":
    case "list":
      return toSpec(getDynamicSourceHandles(data), ["in"]);
    default:
      if (nodeType === "flowStart") {
        return toSpec(["out"], []);
      }
      return toSpec(["out"], ["in"]);
  }
}

function getHandleLabel(node: FlowNode, handleId: string): string | null {
  switch (node.data.kind) {
    case "sendTextMenu":
    case "sendImageMenu": {
      const option = node.data.options.find((item) => item.id === handleId);
      return option?.label.trim() || null;
    }
    case "textButtons":
    case "mediaButtons": {
      const button = node.data.buttons.find((item) => item.id === handleId);
      return button?.label.trim() || null;
    }
    case "list": {
      for (const section of node.data.sections) {
        const row = section.rows.find((item) => item.id === handleId);
        if (row) {
          return row.title.trim() || null;
        }
      }
      return null;
    }
    case "condition":
      return handleId === "true" ? "True" : handleId === "false" ? "False" : null;
    case "whatsappPay":
      return handleId === "success" ? "Success" : handleId === "fail" ? "Failed" : null;
    case "aiAgent":
    case "apiRequest":
    case "googleSheets":
    case "googleSheetsAddRow":
    case "googleSheetsUpdateRow":
    case "googleSheetsFetchRow":
    case "googleSheetsFetchRows":
      return handleId === "success" ? "Success" : handleId === "fail" ? "Failed" : null;
    case "googleCalendarBooking":
      if (handleId === "success") {
        return "Success";
      }
      if (handleId === "cancelled") {
        return "Cancelled";
      }
      return handleId === "fail" ? "Failed" : null;
    case "aiReply":
      return handleId === "out" ? "Continue" : null;
    default:
      return handleId === "out" ? "Next" : null;
  }
}

function describeNode(node: FlowNode): string {
  return `"${node.data.kind}" node ${node.id}`;
}

function isValidVariableName(value: string): boolean {
  return /^[A-Za-z_]\w*$/.test(value.trim());
}

function normalizeBodyPreview(value: string): string {
  return value
    .replace(/"\{\{\w+\}\}"/g, "\"value\"")
    .replace(/\{\{\w+\}\}/g, "0");
}

function allowsMultipleIncomingWires(node: FlowNode, targetHandle: string): boolean {
  return targetHandle === "in" && node.data.kind !== "flowStart";
}

function pushNodeError(
  errors: FlowValidationIssue[],
  node: FlowNode,
  message: string
) {
  errors.push({
    id: `node:${node.id}:${errors.length}`,
    nodeId: node.id,
    message
  });
}

function validateNodeData(
  channel: FlowChannel,
  node: FlowNode,
  errors: FlowValidationIssue[]
) {
  const supportedChannels = BLOCK_CHANNELS[node.data.kind];
  if (!supportedChannels.includes(channel)) {
    pushNodeError(
      errors,
      node,
      `${describeNode(node)} is not available in ${CHANNEL_LABELS[channel]}.`
    );
  }

  switch (node.data.kind) {
    case "sendText":
      if (!node.data.text.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs message text.`);
      }
      break;
    case "sendMedia":
      if (!node.data.url.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a media URL.`);
      }
      break;
    case "sendLocation": {
      const latitude = Number(node.data.latitude);
      const longitude = Number(node.data.longitude);
      if (!node.data.latitude.trim() || Number.isNaN(latitude)) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid latitude.`);
      }
      if (!node.data.longitude.trim() || Number.isNaN(longitude)) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid longitude.`);
      }
      break;
    }
    case "sendContact":
      if (!node.data.name.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a contact name.`);
      }
      if (!node.data.phone.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a phone number.`);
      }
      break;
    case "sendPoll":
      if (!node.data.question.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a poll question.`);
      }
      if (node.data.options.filter((option) => option.trim()).length < 2) {
        pushNodeError(
          errors,
          node,
          `${describeNode(node)} needs at least two non-empty poll options.`
        );
      }
      break;
    case "sendTextMenu":
      if (!node.data.options.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one option.`);
      }
      if (node.data.options.some((option) => !option.label.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} has an empty menu option label.`);
      }
      break;
    case "sendImageMenu":
      if (!node.data.options.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one option.`);
      }
      if (node.data.options.some((option) => !option.label.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} has an empty menu option label.`);
      }
      break;
    case "textButtons":
      if (!node.data.buttons.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one button.`);
      }
      if (node.data.buttons.some((button) => !button.label.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} has an empty button label.`);
      }
      break;
    case "mediaButtons":
      if (!node.data.url.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a media URL.`);
      }
      if (!node.data.buttons.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one button.`);
      }
      if (node.data.buttons.some((button) => !button.label.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} has an empty button label.`);
      }
      break;
    case "list":
      if (!node.data.sections.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one section.`);
      }
      if (
        node.data.sections.some(
          (section) =>
            !section.title.trim() ||
            !section.rows.length ||
            section.rows.some((row) => !row.title.trim())
        )
      ) {
        pushNodeError(
          errors,
          node,
          `${describeNode(node)} needs section titles and non-empty row titles.`
        );
      }
      break;
    case "askQuestion":
      if (!node.data.question.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a question.`);
      }
      if (!node.data.variableName.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a variable name.`);
      }
      break;
    case "askLocation":
      if (!node.data.promptMessage.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a prompt message.`);
      }
      if (!node.data.variableName.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a variable name.`);
      }
      break;
    case "condition":
      if (!node.data.variable.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a variable.`);
      }
      if (
        !["exists", "not_exists"].includes(node.data.operator) &&
        !node.data.value.trim()
      ) {
        pushNodeError(errors, node, `${describeNode(node)} needs a comparison value.`);
      }
      break;
    case "template":
      if (!node.data.templateName.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a template name.`);
      }
      break;
    case "aiAgent":
      if (!node.data.instructions.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs AI instructions.`);
      }
      if (!isValidVariableName(node.data.saveAs.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid save-as variable name.`);
      }
      if (
        node.data.outputMode === "json" &&
        node.data.responseMappings.some(
          (mapping) =>
            !mapping.variableName.trim() ||
            !mapping.path.trim() ||
            !isValidVariableName(mapping.variableName)
        )
      ) {
        pushNodeError(errors, node, `${describeNode(node)} has an invalid JSON field mapping.`);
      }
      break;
    case "requestIntervention":
      if (!node.data.teamId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a team id.`);
      }
      break;
    case "apiRequest":
      if (!node.data.url.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs an API URL.`);
      }
      if (!isValidVariableName(node.data.saveResponseAs.trim())) {
        pushNodeError(
          errors,
          node,
          `${describeNode(node)} needs a valid "save response as" variable name.`
        );
      }
      if (!node.data.timeoutMs.trim() || Number.isNaN(Number(node.data.timeoutMs))) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid timeout in ms.`);
      }
      if (
        node.data.headers.some(
          (header) =>
            (!header.key.trim() && header.value.trim()) ||
            (header.key.trim() && !header.value.trim())
        )
      ) {
        pushNodeError(errors, node, `${describeNode(node)} has an incomplete header row.`);
      }
      if (
        node.data.responseMappings.some(
          (mapping) =>
            !mapping.variableName.trim() ||
            !mapping.path.trim() ||
            !isValidVariableName(mapping.variableName)
        )
      ) {
        pushNodeError(
          errors,
          node,
          `${describeNode(node)} has an invalid response mapping row.`
        );
      }
      if (
        !["GET", "DELETE"].includes(node.data.method) &&
        node.data.bodyMode === "json" &&
        node.data.body.trim()
      ) {
        try {
          JSON.parse(normalizeBodyPreview(node.data.body));
        } catch {
          pushNodeError(
            errors,
            node,
            `${describeNode(node)} has a JSON body that is not valid yet.`
          );
        }
      }
      break;
    case "googleCalendarBooking":
      if (!node.data.connectionId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a connected Google account.`);
      }
      if (!node.data.calendarId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a calendar selection.`);
      }
      if (!isValidVariableName(node.data.saveAs.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid save-as variable name.`);
      }
      if (Number.isNaN(Number(node.data.slotDurationMinutes)) || Number(node.data.slotDurationMinutes) <= 0) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid slot duration in minutes.`);
      }
      if (!node.data.promptMessage.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a slot prompt message.`);
      }
      if (!node.data.reviewMessage.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a review message.`);
      }
      if (!node.data.noAvailabilityMessage.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a no-availability message.`);
      }
      if (!node.data.cancellationMessage.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a cancellation message.`);
      }
      if (node.data.requireName && !node.data.namePrompt.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a name prompt.`);
      }
      if (node.data.requireEmail) {
        if (!node.data.emailPrompt.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs an email prompt.`);
        }
        if (!node.data.invalidEmailMessage.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs an invalid-email message.`);
        }
      }
      if (node.data.requirePhone) {
        if (!node.data.phonePrompt.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a phone prompt.`);
        }
        if (!node.data.invalidPhoneMessage.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs an invalid-phone message.`);
        }
      }
      const bookingMode = node.data.bookingMode ?? "suggest_slots";
      const timeInputMode = node.data.timeInputMode ?? "prefilled";
      if (Number.isNaN(Number(node.data.promptSearchWindowHours)) || Number(node.data.promptSearchWindowHours) <= 0) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid prompt search window in hours.`);
      }
      if (timeInputMode === "ask_user") {
        if (!node.data.timeRequestPrompt.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a time-request prompt.`);
        }
        if (!node.data.invalidTimeRequestMessage.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs an invalid-time message.`);
        }
        if (bookingMode !== "check_only" && !node.data.bookingTitle.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a booking title.`);
        }
      } else if (bookingMode === "suggest_slots") {
        if (!node.data.windowStart.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a window start date-time.`);
        }
        if (!node.data.windowEnd.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a window end date-time.`);
        }
        if (!node.data.bookingTitle.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a booking title.`);
        }
        if (Number.isNaN(Number(node.data.slotIntervalMinutes)) || Number(node.data.slotIntervalMinutes) <= 0) {
          pushNodeError(errors, node, `${describeNode(node)} needs a valid slot interval in minutes.`);
        }
        if (Number.isNaN(Number(node.data.maxOptions)) || Number(node.data.maxOptions) <= 0) {
          pushNodeError(errors, node, `${describeNode(node)} needs a valid max option count.`);
        }
        if (
          node.data.windowStart.trim() &&
          node.data.windowEnd.trim() &&
          !Number.isNaN(Date.parse(node.data.windowStart)) &&
          !Number.isNaN(Date.parse(node.data.windowEnd)) &&
          Date.parse(node.data.windowStart) >= Date.parse(node.data.windowEnd)
        ) {
          pushNodeError(errors, node, `${describeNode(node)} needs a window end that is after the start.`);
        }
      } else {
        if (!node.data.requestedStart.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a requested start date-time.`);
        }
        if (!node.data.alternateWindowStart.trim()) {
          pushNodeError(
            errors,
            node,
            `${describeNode(node)} needs an alternate window start date-time.`
          );
        }
        if (!node.data.alternateWindowEnd.trim()) {
          pushNodeError(
            errors,
            node,
            `${describeNode(node)} needs an alternate window end date-time.`
          );
        }
        if (
          node.data.requestedStart.trim() &&
          node.data.requestedEnd.trim() &&
          !Number.isNaN(Date.parse(node.data.requestedStart)) &&
          !Number.isNaN(Date.parse(node.data.requestedEnd)) &&
          Date.parse(node.data.requestedStart) >= Date.parse(node.data.requestedEnd)
        ) {
          pushNodeError(errors, node, `${describeNode(node)} needs a requested end that is after the start.`);
        }
        if (
          node.data.alternateWindowStart.trim() &&
          node.data.alternateWindowEnd.trim() &&
          !Number.isNaN(Date.parse(node.data.alternateWindowStart)) &&
          !Number.isNaN(Date.parse(node.data.alternateWindowEnd)) &&
          Date.parse(node.data.alternateWindowStart) >= Date.parse(node.data.alternateWindowEnd)
        ) {
          pushNodeError(
            errors,
            node,
            `${describeNode(node)} needs an alternate window end that is after the start.`
          );
        }
        if (bookingMode === "book_if_available" && !node.data.bookingTitle.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a booking title.`);
        }
      }
      if (bookingMode !== "check_only" && !node.data.confirmationMessage.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a confirmation message.`);
      }
      break;
    case "googleSheets": {
      if (!node.data.connectionId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a connected Google account.`);
      }
      if (!node.data.spreadsheetId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a spreadsheet selection.`);
      }
      if (!node.data.sheetTitle.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a sheet selection.`);
      }
      if (!isValidVariableName(node.data.saveAs.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid save-as variable name.`);
      }
      const gsOp = node.data.operation ?? "addRow";
      if (gsOp === "addRow" || gsOp === "updateRow") {
        if (!(node.data.rowValues ?? []).length) {
          pushNodeError(errors, node, `${describeNode(node)} needs at least one column value.`);
        }
        if ((node.data.rowValues ?? []).some((item) => !item.key.trim())) {
          pushNodeError(errors, node, `${describeNode(node)} has a column value without a column name.`);
        }
      }
      if (gsOp === "updateRow" || gsOp === "fetchRow" || gsOp === "fetchRows") {
        if (!node.data.referenceColumn.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a match column.`);
        }
        if (!node.data.referenceValue.trim()) {
          pushNodeError(errors, node, `${describeNode(node)} needs a match value.`);
        }
      }
      break;
    }
    case "googleSheetsAddRow":
      if (!node.data.connectionId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a connected Google account.`);
      }
      if (!node.data.spreadsheetId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a spreadsheet selection.`);
      }
      if (!node.data.sheetTitle.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a sheet selection.`);
      }
      if (!isValidVariableName(node.data.saveAs.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid save-as variable name.`);
      }
      if (!node.data.rowValues.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one mapped column.`);
      }
      if (node.data.rowValues.some((item) => !item.key.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} has a mapped column without a column name.`);
      }
      break;
    case "googleSheetsUpdateRow":
      if (!node.data.connectionId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a connected Google account.`);
      }
      if (!node.data.spreadsheetId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a spreadsheet selection.`);
      }
      if (!node.data.sheetTitle.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a sheet selection.`);
      }
      if (!isValidVariableName(node.data.saveAs.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid save-as variable name.`);
      }
      if (!node.data.referenceColumn.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a match column.`);
      }
      if (!node.data.referenceValue.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a match value.`);
      }
      if (!node.data.rowValues.length) {
        pushNodeError(errors, node, `${describeNode(node)} needs at least one mapped column.`);
      }
      if (node.data.rowValues.some((item) => !item.key.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} has a mapped column without a column name.`);
      }
      break;
    case "googleSheetsFetchRow":
    case "googleSheetsFetchRows":
      if (!node.data.connectionId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a connected Google account.`);
      }
      if (!node.data.spreadsheetId.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a spreadsheet selection.`);
      }
      if (!node.data.sheetTitle.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a sheet selection.`);
      }
      if (!isValidVariableName(node.data.saveAs.trim())) {
        pushNodeError(errors, node, `${describeNode(node)} needs a valid save-as variable name.`);
      }
      if (!node.data.referenceColumn.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a match column.`);
      }
      if (!node.data.referenceValue.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs a match value.`);
      }
      break;
    case "whatsappPay":
      if (!node.data.amount.trim()) {
        pushNodeError(errors, node, `${describeNode(node)} needs an amount.`);
      }
      break;
    default:
      break;
  }
}

function validateChoiceConnections(
  node: FlowNode,
  edges: FlowEdge[],
  errors: FlowValidationIssue[]
) {
  const dynamicHandles = getDynamicSourceHandles(node.data);
  if (!dynamicHandles.length) {
    return;
  }

  for (const handleId of dynamicHandles) {
    const isConnected = edges.some(
      (edge) => edge.source === node.id && edge.sourceHandle === handleId
    );
    if (isConnected) {
      continue;
    }
    const label = getHandleLabel(node, handleId) ?? handleId;
    pushNodeError(
      errors,
      node,
      `${describeNode(node)} has no next step connected for "${label}".`
    );
  }
}

function isEdgeDuplicate(
  seenKeys: Set<string>,
  edgeKey: string
) {
  if (seenKeys.has(edgeKey)) {
    return true;
  }
  seenKeys.add(edgeKey);
  return false;
}

export function getConnectionError(
  connection: Connection,
  nodes: FlowNode[],
  edges: FlowEdge[]
): string | null {
  const { source, target, sourceHandle, targetHandle } = connection;

  if (!source || !target) {
    return "Connect a block from one output handle to one input handle.";
  }
  if (!sourceHandle || !targetHandle) {
    return "Use the node handles to connect blocks.";
  }
  if (source === target) {
    return "A block cannot connect to itself.";
  }

  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);

  if (!sourceNode || !targetNode) {
    return "That connection points to a missing block.";
  }

  const sourceHandles = getNodeHandleSpec(String(sourceNode.type), sourceNode.data);
  const targetHandles = getNodeHandleSpec(String(targetNode.type), targetNode.data);

  if (!sourceHandles.source.has(sourceHandle)) {
    return "That output handle is no longer available on the source block.";
  }
  if (!targetHandles.target.has(targetHandle)) {
    return "That input handle is no longer available on the target block.";
  }

  if (
    edges.some(
      (edge) =>
        edge.source === source &&
        edge.sourceHandle === sourceHandle &&
        edge.target === target &&
        edge.targetHandle === targetHandle
    )
  ) {
    return "Those two blocks are already connected.";
  }

  if (
    edges.some(
      (edge) =>
        edge.source === source &&
        edge.sourceHandle === sourceHandle &&
        (edge.target !== target || edge.targetHandle !== targetHandle)
    )
  ) {
    return "Each output handle can connect to only one next step.";
  }

  if (
    edges.some(
      (edge) =>
        edge.target === target &&
        edge.targetHandle === targetHandle &&
        (edge.source !== source || edge.sourceHandle !== sourceHandle)
    )
    && !allowsMultipleIncomingWires(targetNode, targetHandle)
  ) {
    return "Each block input can receive only one incoming wire.";
  }

  return null;
}

export function pruneInvalidNodeEdges(
  edges: FlowEdge[],
  nodeId: string,
  nodeType: string,
  data: AnyNodeData
): FlowEdge[] {
  const handles = getNodeHandleSpec(nodeType, data);

  return edges.filter((edge) => {
    if (edge.source === nodeId) {
      return !!edge.sourceHandle && handles.source.has(edge.sourceHandle);
    }
    if (edge.target === nodeId) {
      return !!edge.targetHandle && handles.target.has(edge.targetHandle);
    }
    return true;
  });
}

export function validateFlow(
  channel: FlowChannel,
  nodes: FlowNode[],
  edges: FlowEdge[]
): FlowValidationResult {
  const errors: FlowValidationIssue[] = [];
  const warnings: FlowValidationIssue[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const startNodes = nodes.filter((node) => node.data.kind === "flowStart");
  const exactEdgeKeys = new Set<string>();
  const outgoingCounts = new Map<string, FlowEdge[]>();
  const incomingCounts = new Map<string, FlowEdge[]>();
  const adjacency = new Map<string, string[]>();

  if (startNodes.length !== 1) {
    errors.push({
      id: "flow:start-count",
      message:
        startNodes.length === 0
          ? "Flow needs exactly one Flow Start block."
          : "Flow can only have one Flow Start block."
    });
  }

  for (const node of nodes) {
    validateNodeData(channel, node, errors);
  }

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    const edgeKey = `${edge.source}:${edge.sourceHandle ?? ""}->${edge.target}:${edge.targetHandle ?? ""}`;

    if (isEdgeDuplicate(exactEdgeKeys, edgeKey)) {
      errors.push({
        id: `edge:${edge.id}:duplicate`,
        edgeId: edge.id,
        message: "Duplicate wire detected between the same two handles."
      });
    }

    if (edge.source === edge.target) {
      errors.push({
        id: `edge:${edge.id}:self`,
        edgeId: edge.id,
        message: `Block ${edge.source} cannot connect to itself.`
      });
    }

    if (!sourceNode || !targetNode) {
      errors.push({
        id: `edge:${edge.id}:missing-node`,
        edgeId: edge.id,
        message: `Wire ${edge.id} points to a missing block.`
      });
      continue;
    }

    const sourceHandles = getNodeHandleSpec(String(sourceNode.type), sourceNode.data);
    const targetHandles = getNodeHandleSpec(String(targetNode.type), targetNode.data);

    if (!edge.sourceHandle || !sourceHandles.source.has(edge.sourceHandle)) {
      errors.push({
        id: `edge:${edge.id}:bad-source`,
        edgeId: edge.id,
        message: `${describeNode(sourceNode)} has an invalid or stale output wire.`
      });
    }

    if (!edge.targetHandle || !targetHandles.target.has(edge.targetHandle)) {
      errors.push({
        id: `edge:${edge.id}:bad-target`,
        edgeId: edge.id,
        message: `${describeNode(targetNode)} has an invalid or stale input wire.`
      });
    }

    if (!edge.sourceHandle || !edge.targetHandle) {
      continue;
    }

    const outgoingKey = `${edge.source}:${edge.sourceHandle}`;
    const incomingKey = `${edge.target}:${edge.targetHandle}`;

    outgoingCounts.set(outgoingKey, [...(outgoingCounts.get(outgoingKey) ?? []), edge]);
    incomingCounts.set(incomingKey, [...(incomingCounts.get(incomingKey) ?? []), edge]);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  for (const [handleKey, groupedEdges] of outgoingCounts.entries()) {
    if (groupedEdges.length < 2) {
      continue;
    }
    const [nodeId, handleId] = handleKey.split(":");
    const node = nodeMap.get(nodeId);
    const label = node ? getHandleLabel(node, handleId) ?? handleId : handleId;
    errors.push({
      id: `outgoing:${handleKey}`,
      nodeId,
      message: `Output "${label}" is wired to multiple next steps.`
    });
  }

  for (const [handleKey, groupedEdges] of incomingCounts.entries()) {
    if (groupedEdges.length < 2) {
      continue;
    }
    const [nodeId, handleId] = handleKey.split(":");
    const node = nodeMap.get(nodeId);
    if (node && allowsMultipleIncomingWires(node, handleId)) {
      continue;
    }
    errors.push({
      id: `incoming:${handleKey}`,
      nodeId,
      message: `Block ${nodeId} has multiple incoming wires on the same input.`
    });
  }

  for (const node of nodes) {
    validateChoiceConnections(node, edges, errors);
  }

  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];

    while (queue.length) {
      const current = queue.shift();
      if (!current || reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!reachable.has(next)) {
          queue.push(next);
        }
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        warnings.push({
          id: `unreachable:${node.id}`,
          nodeId: node.id,
          message: `${describeNode(node)} is unreachable from Flow Start.`
        });
      }
    }
  }

  return { errors, warnings };
}
