const SCALE = 4;

function toScaled(text: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,4}))?$/.exec(text.trim());
  if (!match) return null;
  return BigInt(match[1] + (match[2] ?? "").padEnd(SCALE, "0"));
}

function fromScaled(value: bigint): string {
  const digits = value.toString().padStart(SCALE + 1, "0");
  const whole = digits.slice(0, -SCALE);
  const frac = digits.slice(-SCALE).replace(/0+$/, "");
  return frac === "" ? whole : `${whole},${frac}`;
}

/**
 * "- campo +" of the product list (same rule as the app): one step up or down from the cart quantity, in exact decimal
 * (4 places, no float). Reaching zero or below returns `null` = remove from the cart. An unreadable text counts as the step.
 */
export function stepQuantity(current: string, direction: 1 | -1, step?: string | null): string | null {
  const unit = (step ? toScaled(step) : null) ?? 10n ** BigInt(SCALE);
  const base = toScaled(current) ?? 0n;
  const next = base + unit * BigInt(direction);
  return next <= 0n ? null : fromScaled(next);
}

/** Typed quantity in the cart field: empty or zero removes (`null`); otherwise the text is validated by the caller. */
export function isRemovalText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  const scaled = toScaled(trimmed);
  return scaled !== null && scaled === 0n;
}
