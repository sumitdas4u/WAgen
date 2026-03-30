export interface CapturedLocationInput {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  url?: string;
  source?: "native" | "text";
}

export interface CapturedPollInput {
  question?: string;
  selectedOptions: string[];
  allowMultiple?: boolean;
  source?: "native" | "text";
}

const LOCATION_PREFIX = "__flow_location__:";
const POLL_PREFIX = "__flow_poll__:";

function parseJsonPayload<T>(value: string, prefix: string): T | null {
  if (!value.startsWith(prefix)) {
    return null;
  }

  const raw = value.slice(prefix.length).trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function encodeFlowLocationInput(input: CapturedLocationInput): string {
  return `${LOCATION_PREFIX}${JSON.stringify(input)}`;
}

export function formatFlowLocationValue(input: CapturedLocationInput): string {
  return `${input.latitude}, ${input.longitude}`;
}

export function formatFlowLocationSummary(input: CapturedLocationInput): string {
  const parts = ["[Location]"];
  const name = cleanLine(input.name);
  const address = cleanLine(input.address);

  if (name) {
    parts.push(name);
  }
  if (address) {
    parts.push(address);
  }
  parts.push(formatFlowLocationValue(input));

  return parts.join("\n");
}

function parsePlainLocationInput(message: string): CapturedLocationInput | null {
  const coordinateMatch = message.match(
    /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/u
  );
  if (!coordinateMatch) {
    return null;
  }

  const latitude = Number(coordinateMatch[1]);
  const longitude = Number(coordinateMatch[2]);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    source: "text"
  };
}

export function parseFlowLocationInput(message: string): CapturedLocationInput | null {
  const structured = parseJsonPayload<Partial<CapturedLocationInput>>(message, LOCATION_PREFIX);
  if (structured) {
    const latitude = Number(structured.latitude);
    const longitude = Number(structured.longitude);
    if (!Number.isNaN(latitude) && !Number.isNaN(longitude)) {
      return {
        latitude,
        longitude,
        ...(cleanLine(structured.name) ? { name: cleanLine(structured.name) } : {}),
        ...(cleanLine(structured.address) ? { address: cleanLine(structured.address) } : {}),
        ...(cleanLine(structured.url) ? { url: cleanLine(structured.url) } : {}),
        source: structured.source === "text" ? "text" : "native"
      };
    }
  }

  return parsePlainLocationInput(message);
}

export function encodeFlowPollInput(input: CapturedPollInput): string {
  return `${POLL_PREFIX}${JSON.stringify(input)}`;
}

export function formatFlowPollValue(input: CapturedPollInput): string {
  return input.selectedOptions.map(cleanLine).filter(Boolean).join(", ");
}

export function formatFlowPollSummary(input: CapturedPollInput): string {
  const selectionText = formatFlowPollValue(input);
  const question = cleanLine(input.question);
  return [question ? `[Poll] ${question}` : "[Poll]", selectionText]
    .filter(Boolean)
    .join("\n");
}

export function parseFlowPollInput(message: string): CapturedPollInput | null {
  const structured = parseJsonPayload<Partial<CapturedPollInput>>(message, POLL_PREFIX);
  if (!structured) {
    return null;
  }

  const selectedOptions = Array.isArray(structured.selectedOptions)
    ? structured.selectedOptions.map(cleanLine).filter(Boolean)
    : [];
  if (!selectedOptions.length) {
    return null;
  }

  return {
    ...(cleanLine(structured.question) ? { question: cleanLine(structured.question) } : {}),
    selectedOptions,
    allowMultiple: Boolean(structured.allowMultiple),
    source: structured.source === "text" ? "text" : "native"
  };
}
