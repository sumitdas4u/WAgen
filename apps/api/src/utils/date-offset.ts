export interface DateOffset {
  direction: "add" | "subtract";
  value: number;
  unit: "days" | "weeks" | "months" | "years";
}

export function applyDateOffset(base: Date, offset: DateOffset): string {
  const d = new Date(base);
  const n = offset.direction === "subtract" ? -offset.value : offset.value;
  if (offset.unit === "days")   d.setDate(d.getDate() + n);
  if (offset.unit === "weeks")  d.setDate(d.getDate() + n * 7);
  if (offset.unit === "months") d.setMonth(d.getMonth() + n);
  if (offset.unit === "years")  d.setFullYear(d.getFullYear() + n);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function parseDateString(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const direct = new Date(raw);
  if (!isNaN(direct.getTime())) return direct;
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
