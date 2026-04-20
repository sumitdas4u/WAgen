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
  const s = raw.trim();

  // YYYY-MM-DD, YYYY/MM/DD, or ISO with time (year-first = unambiguous)
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(T.*)?$/.test(s)) {
    const d = new Date(s.replace(/\//g, "-"));
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (day-first, treat first segment as day)
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]), month = Number(dmy[2]), year = Number(dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      // verify no date overflow (e.g. Feb 30 wraps)
      if (!isNaN(d.getTime()) && d.getDate() === day) return d;
    }
  }

  // "20 Apr 2026" or "20 April 2026"
  const dmmmY = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmmmY) {
    const d = new Date(`${dmmmY[2]} ${dmmmY[1]}, ${dmmmY[3]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // "Apr 20, 2026" / "April 20 2026" / other text formats — let engine try
  if (/^[A-Za-z]/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  // Unix timestamp in milliseconds (13 digits)
  if (/^\d{13}$/.test(s)) {
    const d = new Date(Number(s));
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}
