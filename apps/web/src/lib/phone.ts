export function normalizePhoneInput(input: string): string {
  const trimmed = input.trim();
  const withoutSeparators = trimmed.replace(/[\s().-]/g, "");
  let digits = withoutSeparators.startsWith("+")
    ? withoutSeparators.slice(1).replace(/\D/g, "")
    : withoutSeparators.replace(/\D/g, "").replace(/^00/, "");

  if (/^[6-9]\d{9}$/.test(digits)) {
    digits = `91${digits}`;
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error("Enter phone in international format: +91XXXXXXXXXX");
  }
  if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) {
    throw new Error("Enter a valid 10-digit Indian mobile number with +91 country code.");
  }

  return `+${digits}`;
}
