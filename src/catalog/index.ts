import type { PaintKit, WeaponDef } from "../contract.js";
import { PAINTS } from "./paints.js";
import { WEAPONS } from "./weapons.js";

export { PAINTS, WEAPONS };

const weaponsById = new Map<number, WeaponDef>();
const weaponsByKey = new Map<string, WeaponDef>();
const paintsById = new Map<number, PaintKit>();
const paintsByKey = new Map<string, PaintKit>();
/** Normalized paint keys that belong to more than one kit, such as Hyper Beast. */
const ambiguousPaintKeys = new Set<string>();

/** Lowercase and drop separators so "AK-47", "ak47", and "ak 47" match. */
function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumericId(query: string): number | undefined {
  if (!/^\d+$/.test(query)) return undefined;
  const id = Number(query);
  return Number.isSafeInteger(id) ? id : undefined;
}

function addKey<T extends { id: number; name: string }>(
  map: Map<string, T>,
  key: string,
  item: T,
  label: string,
): void {
  const norm = normalize(key);
  if (!norm) return;
  const existing = map.get(norm);
  if (existing && existing.id !== item.id) {
    throw new Error(
      `${label} key "${key}" matches both ${existing.name} (${existing.id}) and ${item.name} (${item.id})`,
    );
  }
  map.set(norm, item);
}

for (const weapon of WEAPONS) {
  if (weaponsById.has(weapon.id)) {
    throw new Error(`Duplicate weapon id ${weapon.id}`);
  }
  weaponsById.set(weapon.id, weapon);
  addKey(weaponsByKey, weapon.name, weapon, "weapon");
  addKey(weaponsByKey, weapon.className, weapon, "weapon");
  for (const alias of weapon.aliases) {
    addKey(weaponsByKey, alias, weapon, "weapon");
  }
}

function addPaintKey(key: string, paint: PaintKit): void {
  const norm = normalize(key);
  if (!norm || ambiguousPaintKeys.has(norm)) return;
  const existing = paintsByKey.get(norm);
  if (existing && existing.id !== paint.id) {
    paintsByKey.delete(norm);
    ambiguousPaintKeys.add(norm);
    return;
  }
  paintsByKey.set(norm, paint);
}

for (const paint of PAINTS) {
  if (paintsById.has(paint.id)) {
    throw new Error(`Duplicate paint id ${paint.id}`);
  }
  paintsById.set(paint.id, paint);
  addPaintKey(paint.name, paint);
  for (const alias of paint.aliases) {
    addPaintKey(alias, paint);
  }
}

export function resolveWeapon(query: string): WeaponDef | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const id = parseNumericId(trimmed);
  if (id !== undefined) {
    const byId = weaponsById.get(id);
    if (byId) return byId;
  }
  return weaponsByKey.get(normalize(trimmed));
}

/**
 * Known names and aliases resolve to the curated kit. A numeric string is that
 * kit when present, otherwise `{ id, name: String(id), aliases: [], weapons: [] }`.
 * Unknown names return undefined.
 */
export function resolvePaint(query: string): PaintKit | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const id = parseNumericId(trimmed);
  if (id !== undefined) {
    return paintsById.get(id) ?? { id, name: String(id), aliases: [], weapons: [] };
  }
  return paintsByKey.get(normalize(trimmed));
}

export function paintName(id: number): string | null {
  return paintsById.get(id)?.name ?? null;
}

export function weaponName(id: number): string | null {
  return weaponsById.get(id)?.name ?? null;
}
