import type { FieldSpec, FieldValue, Serializer } from "../contract.js";
import type { EditableField, EditableRecord, FieldAppend } from "../entity/delta.js";
import { COSMETIC_NAMES, assertCosmeticWrite, vanillaCosmetic } from "./policy.js";

const STICKER_DEFS = new Set([113, 117, 121, 125, 129]);

export type CosmeticPatch = {
  paint?: number;
  seed?: number;
  wear?: number;
  stattrak?: number;
  stickers?: boolean;
};

export function applyCosmeticPatch(
  record: EditableRecord,
  serializer: Serializer,
  serializers: Map<string, Serializer>,
  patch: CosmeticPatch,
  warnings: string[],
): { before: { paint: number; seed: number; wear: number; stattrak: number }; after: { paint: number; seed: number; wear: number; stattrak: number } } | null {
  if (record.kind !== "update" && record.kind !== "create") return null;
  const fields = record.fields as EditableField[];
  const before = readCosmetics(fields);
  const wanted = { ...before };
  if (patch.paint !== undefined) wanted.paint = patch.paint;
  if (patch.seed !== undefined) wanted.seed = patch.seed;
  if (patch.wear !== undefined) wanted.wear = patch.wear;
  if (patch.stattrak !== undefined) wanted.stattrak = patch.stattrak;
  const targets: Array<[string, number]> = [];
  if (patch.paint !== undefined) targets.push([COSMETIC_NAMES.paint, patch.paint]);
  if (patch.seed !== undefined) targets.push([COSMETIC_NAMES.seed, patch.seed]);
  if (patch.wear !== undefined) targets.push([COSMETIC_NAMES.wear, patch.wear]);
  if (patch.stattrak !== undefined) targets.push([COSMETIC_NAMES.stattrak, patch.stattrak]);
  for (const [name, value] of targets) {
    assertCosmeticWrite(name);
    writeCosmetic(record, fields, serializer, serializers, name, value, warnings);
  }
  if (patch.stickers) zeroStickers(fields, warnings, record.index);
  const changed = targets.some(([name, value]) => currentNumber(fields, name) !== value || beforeValue(before, name) !== value);
  if (!changed && !patch.stickers) return null;
  return { before, after: wanted };
}

export function stripPatch(): CosmeticPatch {
  const vanilla = vanillaCosmetic();
  return { ...vanilla, stickers: false };
}

function beforeValue(
  before: { paint: number; seed: number; wear: number; stattrak: number },
  name: string,
): number {
  if (name === COSMETIC_NAMES.paint) return before.paint;
  if (name === COSMETIC_NAMES.seed) return before.seed;
  if (name === COSMETIC_NAMES.wear) return before.wear;
  return before.stattrak;
}

function readCosmetics(fields: EditableField[]): { paint: number; seed: number; wear: number; stattrak: number } {
  const vanilla = vanillaCosmetic();
  return {
    paint: currentNumber(fields, COSMETIC_NAMES.paint) ?? vanilla.paint,
    seed: currentNumber(fields, COSMETIC_NAMES.seed) ?? vanilla.seed,
    wear: currentNumber(fields, COSMETIC_NAMES.wear) ?? vanilla.wear,
    stattrak: currentNumber(fields, COSMETIC_NAMES.stattrak) ?? vanilla.stattrak,
  };
}

function currentNumber(fields: EditableField[], name: string): number | null {
  const field = fields.find((item) => item.namePath[item.namePath.length - 1] === name);
  if (!field) return null;
  return numberOf(field.valueOverride ?? field.value);
}

function writeCosmetic(
  record: EditableRecord,
  fields: EditableField[],
  serializer: Serializer,
  serializers: Map<string, Serializer>,
  name: string,
  value: number,
  warnings: string[],
): void {
  const existing = fields.find((item) => item.namePath[item.namePath.length - 1] === name);
  if (existing) {
    existing.valueOverride = valueFor(existing.spec, value);
    return;
  }
  const located = findField(serializer, serializers, name, []);
  if (!located) {
    warnings.push(`entity ${record.index} has no ${name} field to append`);
    return;
  }
  const append: FieldAppend = {
    path: located.path,
    namePath: located.namePath,
    spec: located.spec,
    value: valueFor(located.spec, value),
  };
  record.append = [...(record.append ?? []), append];
}

function findField(
  serializer: Serializer,
  serializers: Map<string, Serializer>,
  name: string,
  prefix: number[],
): { path: number[]; namePath: string[]; spec: FieldSpec } | null {
  for (let index = 0; index < serializer.fields.length; index++) {
    const field = serializer.fields[index];
    if (!field) continue;
    if (field.serializerName) {
      const nested = serializers.get(field.serializerName);
      if (!nested) continue;
      const found = findField(nested, serializers, name, [...prefix, index]);
      if (found) return { ...found, namePath: [field.name, ...found.namePath] };
      continue;
    }
    if (field.name === name) return { path: [...prefix, index], namePath: [field.name], spec: field };
  }
  return null;
}

function zeroStickers(fields: EditableField[], warnings: string[], entity: number): void {
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field) continue;
    const leaf = field.namePath[field.namePath.length - 1] ?? "";
    const value = numberOf(field.value);
    if (!leaf.toLowerCase().includes("attributedefinition") || value === null || !STICKER_DEFS.has(value)) continue;
    const next = fields[index + 1];
    const nextLeaf = next?.namePath[next.namePath.length - 1] ?? "";
    if (!next || !nextLeaf.toLowerCase().includes("value")) {
      warnings.push(`entity ${entity} sticker layout was not obvious`);
      return;
    }
    assertCosmeticWrite(nextLeaf);
    next.valueOverride = valueFor(next.spec, 0);
  }
}

function valueFor(spec: FieldSpec, value: number): FieldValue {
  if (spec.typeName.toLowerCase().includes("float")) return { kind: "float", value };
  return { kind: "int", value };
}

function numberOf(value: FieldValue | undefined): number | null {
  if (!value) return null;
  if (value.kind === "int" || value.kind === "uint" || value.kind === "float") return value.value;
  return null;
}
