import { isKnifeId } from "../catalog/index.js";
import { COSMETIC_FIELDS, PROTECTED_FIELD_NAMES } from "../contract.js";

const PROTECTED = new Set<string>(PROTECTED_FIELD_NAMES);

export function fieldLeaf(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

export function isProtectedField(name: string): boolean {
  return PROTECTED.has(fieldLeaf(name));
}

/** Throws when a write would change which weapon is equipped. */
export function assertCosmeticWrite(name: string): void {
  if (isProtectedField(name)) {
    throw new Error(`refusing to write protected field ${fieldLeaf(name)}`);
  }
}

/**
 * Knife operations may change `m_iItemDefinitionIndex` only from one knife to
 * another knife. Guns, and anything else, still throw.
 */
export function assertKnifeDefinitionWrite(from: number, to: number): void {
  if (isKnifeId(from) && isKnifeId(to)) return;
  throw new Error(`refusing to change definition index ${from} to ${to}`);
}

export function vanillaCosmetic(): { paint: number; seed: number; wear: number; stattrak: number } {
  return { paint: 0, seed: 0, wear: 0, stattrak: -1 };
}

export const COSMETIC_NAMES = {
  paint: COSMETIC_FIELDS.paint,
  seed: COSMETIC_FIELDS.seed,
  wear: COSMETIC_FIELDS.wear,
  stattrak: COSMETIC_FIELDS.stattrak,
} as const;
