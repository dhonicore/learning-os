/** Join class names, dropping falsy values. Keeps conditional styling readable. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
