export function requireExecutionRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid execution object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new Error("Unexpected execution fields.");
  }
  return record;
}

export function requireExecutionId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) {
    throw new Error("Invalid execution identifier.");
  }
  return value;
}

export function requireExecutionInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error("Invalid execution limit.");
  }
  return value;
}

export function requireExecutionArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid execution list.");
  return value;
}
