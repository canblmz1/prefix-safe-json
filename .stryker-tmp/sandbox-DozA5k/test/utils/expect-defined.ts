// @ts-nocheck
export function expectDefined<T>(
  value: T | undefined | null,
  message = "Expected value to be defined",
): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
