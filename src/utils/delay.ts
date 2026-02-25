export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("min/max must be finite numbers");
  }

  if (min < 0 || max < 0 || max < min) {
    throw new Error("invalid range: expected 0 <= min <= max");
  }

  const normalizedMin = Math.floor(min);
  const normalizedMax = Math.floor(max);
  return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

export async function randomDelay(min: number, max: number): Promise<void> {
  await delay(randomInt(min, max));
}

