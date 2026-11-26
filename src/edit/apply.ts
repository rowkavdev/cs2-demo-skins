import { isKnifeId } from "../catalog/index.js";
import { STICKER_SLOT_ATTRS } from "../contract.js";
import type { FieldSpec, FieldValue, Serializer } from "../contract.js";
import type { EditableField, EditableRecord, FieldAppend } from "../entity/delta.js";
import { floatToIntBits, intBitsToFloat } from "../entity/values.js";
import { COSMETIC_NAMES, assertCosmeticWrite, assertKnifeDefinitionWrite, vanillaCosmetic } from "./policy.js";

const STICKER_DEFS = new Set<number>(STICKER_SLOT_ATTRS);

export type CosmeticPatch = {
  paint?: number;
  seed?: number;
  wear?: number;
  stattrak?: number;
  stickers?: boolean;
};

export type AttrState = {
  length: number;
  elements: Array<{ def: number; raw: number } | undefined>;
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

/**
 * Writes a knife definition index. Refuses guns. Also sets entity quality to 3
 * for custom knives (500+) and 0 for the stock CT/T knives, when that field exists.
 * The entity class is not changed. `m_iItemIDHigh` is left alone.
 */
export function applyKnifeChange(
  record: EditableRecord,
  serializer: Serializer,
  serializers: Map<string, Serializer>,
  fromId: number,
  toId: number,
  warnings: string[],
): { before: number; after: number } | null {
  if (record.kind !== "update" && record.kind !== "create") return null;
  if (!isKnifeId(fromId)) return null;
  assertKnifeDefinitionWrite(fromId, toId);
  const fields = record.fields as EditableField[];
  const def = fields.find((field) => leaf(field) === "m_iItemDefinitionIndex");
  const encoded = def ? numberOf(def.value) : null;
  const wantQuality = toId >= 500 ? 3 : 0;
  const quality = fields.find((field) => leaf(field) === "m_iEntityQuality");
  const qualityNow = quality ? numberOf(quality.value) : null;
  const defNeeds = encoded !== toId;
  const qualityNeeds = quality ? qualityNow !== wantQuality : false;
  if (!defNeeds && !qualityNeeds && quality) return null;
  if (defNeeds) {
    if (def) def.valueOverride = valueFor(def.spec, toId);
    else writeNamed(record, fields, serializer, serializers, "m_iItemDefinitionIndex", toId, warnings);
  }
  if (quality) {
    if (qualityNow !== wantQuality) quality.valueOverride = valueFor(quality.spec, wantQuality);
  } else {
    const located = findField(serializer, serializers, "m_iEntityQuality", []);
    if (!located) {
      warnings.push(`entity ${record.index} knife model changed without m_iEntityQuality`);
    } else {
      record.append = [...(record.append ?? []), appendOf(located, wantQuality)];
    }
  }
  if (!def && !defNeeds) return null;
  return { before: encoded ?? fromId, after: toId };
}

/**
 * Writes sticker kit ids into the default slot attributes (113, 117, 121, 125, 129).
 * Wear, scale, rotation, and offset stay unset, so each gun uses its own slot positions.
 * `length`, when set, is a restore cap: elements at or past that length are not created,
 * and the vector length is written back.
 */
export function applyStickerCraft(
  record: EditableRecord,
  serializer: Serializer,
  serializers: Map<string, Serializer>,
  kits: number[],
  state: AttrState,
  warnings: string[],
  restoreLength: number | null = null,
): { before: number[]; after: number[] } | null {
  if (record.kind !== "update" && record.kind !== "create") return null;
  if (kits.length > STICKER_SLOT_ATTRS.length || (restoreLength === null && kits.length < 1)) {
    warnings.push(`entity ${record.index} sticker craft needs 1 to ${STICKER_SLOT_ATTRS.length} slots`);
    return null;
  }
  const located = findStickerVector(serializer, serializers);
  if (!located) {
    warnings.push(`entity ${record.index} has no sticker attribute list`);
    return null;
  }
  const defPos = located.element.fields.findIndex((field) => field.name === "m_iAttributeDefinitionIndex");
  const rawPos = located.element.fields.findIndex((field) => field.name === "m_iRawValue32");
  const defSpec = located.element.fields[defPos];
  const rawSpec = located.element.fields[rawPos];
  if (!defSpec || !rawSpec || defPos < 0 || rawPos < 0) {
    warnings.push(`entity ${record.index} sticker attributes have no id and raw value`);
    return null;
  }

  const view = readAttributeFields(record.fields as EditableField[]);
  if (view.length !== null) {
    state.length = view.length;
    state.elements.length = Math.min(state.elements.length, view.length);
  }
  for (const [index, element] of view.elements) {
    const current = state.elements[index] ?? { def: element.def ?? 0, raw: element.raw ?? 0 };
    if (element.def !== undefined) current.def = element.def;
    if (element.raw !== undefined) current.raw = element.raw;
    state.elements[index] = current;
    if (index + 1 > state.length) state.length = index + 1;
  }

  const before = kits.map((_, slot) => rawOf(state, STICKER_SLOT_ATTRS[slot] ?? 0));
  const after = before.slice();
  let changed = false;
  const startLength = state.length;

  for (let slot = 0; slot < kits.length; slot++) {
    const attr = STICKER_SLOT_ATTRS[slot] ?? 0;
    const kit = kits[slot] ?? 0;
    let index = state.elements.findIndex((element) => element?.def === attr);
    if (index < 0) {
      if (kit === 0 || (restoreLength !== null && state.length >= restoreLength)) {
        after[slot] = 0;
        continue;
      }
      index = state.length;
      state.elements[index] = { def: attr, raw: kit };
      state.length = index + 1;
      pushAppend(record, [...located.path, index, defPos], [...located.names, pad(index), defSpec.name], defSpec, valueFor(defSpec, attr));
      pushAppend(record, [...located.path, index, rawPos], [...located.names, pad(index), rawSpec.name], rawSpec, storedInteger(rawSpec, kit));
      after[slot] = kit;
      changed = true;
      continue;
    }
    if (restoreLength !== null && index >= restoreLength) {
      after[slot] = 0;
      continue;
    }
    const current = state.elements[index];
    if (!current || current.raw === kit) {
      after[slot] = current?.raw ?? kit;
      continue;
    }
    const rawPath = [...located.path, index, rawPos];
    const existing = (record.fields as EditableField[]).find((field) => samePath(field.path, rawPath));
    if (existing) existing.valueOverride = storedInteger(existing.spec, kit);
    else pushAppend(record, rawPath, [...located.names, pad(index), rawSpec.name], rawSpec, storedInteger(rawSpec, kit));
    current.raw = kit;
    after[slot] = kit;
    changed = true;
  }

  const wantedLength = restoreLength ?? state.length;
  if (wantedLength !== startLength || (view.length !== null && view.length !== wantedLength)) {
    writeLength(record, located, wantedLength);
    state.length = wantedLength;
    state.elements.length = wantedLength;
    changed = true;
  }
  if (!changed) return null;
  return { before, after };
}

export function readAttributeFields(fields: EditableField[]): {
  length: number | null;
  elements: Map<number, { def?: number; raw?: number }>;
} {
  const elements = new Map<number, { def?: number; raw?: number }>();
  let length: number | null = null;
  for (const field of fields) {
    const names = field.namePath;
    const attrAt = names.lastIndexOf("m_Attributes");
    if (attrAt < 0) continue;
    const leafName = names[names.length - 1] ?? "";
    if (attrAt === names.length - 1) {
      const count = numberOf(field.valueOverride ?? field.value);
      if (count !== null) length = count;
      continue;
    }
    const indexText = names[attrAt + 1] ?? "";
    if (!/^\d+$/.test(indexText)) continue;
    const index = Number(indexText);
    const slot = elements.get(index) ?? {};
    if (leafName === "m_iAttributeDefinitionIndex") {
      const def = numberOf(field.valueOverride ?? field.value);
      if (def !== null) slot.def = def;
    }
    if (leafName === "m_iRawValue32") {
      const raw = rawInteger(field);
      if (raw !== null) slot.raw = raw;
    }
    elements.set(index, slot);
  }
  return { length, elements };
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
  const field = fields.find((item) => leaf(item) === name);
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
  const existing = fields.find((item) => leaf(item) === name);
  if (existing) {
    existing.valueOverride = valueFor(existing.spec, value);
    return;
  }
  writeNamed(record, fields, serializer, serializers, name, value, warnings);
}

function writeNamed(
  record: EditableRecord,
  _fields: EditableField[],
  serializer: Serializer,
  serializers: Map<string, Serializer>,
  name: string,
  value: number,
  warnings: string[],
): void {
  const located = findField(serializer, serializers, name, []);
  if (!located) {
    warnings.push(`entity ${record.index} has no ${name} field to append`);
    return;
  }
  record.append = [...(record.append ?? []), appendOf(located, value)];
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
      if (isVectorType(field.typeName)) continue;
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

function findStickerVector(
  serializer: Serializer,
  serializers: Map<string, Serializer>,
): { path: number[]; names: string[]; element: Serializer } | null {
  const found: Array<{ path: number[]; names: string[]; element: Serializer }> = [];
  const walk = (current: Serializer, prefix: number[], names: string[]): void => {
    for (let index = 0; index < current.fields.length; index++) {
      const field = current.fields[index];
      if (!field?.serializerName) continue;
      if (isVectorType(field.typeName) && field.name === "m_Attributes") {
        const element = serializers.get(field.serializerName);
        if (element) found.push({ path: [...prefix, index], names: [...names, field.name], element });
        continue;
      }
      if (!isVectorType(field.typeName)) {
        const nested = serializers.get(field.serializerName);
        if (nested) walk(nested, [...prefix, index], [...names, field.name]);
      }
    }
  };
  walk(serializer, [], []);
  return (
    found.find((item) => item.names.includes("m_AttributeList") && !item.names.some((name) => name.includes("Dynamic"))) ??
    found[0] ??
    null
  );
}

function zeroStickers(fields: EditableField[], warnings: string[], entity: number): void {
  const groups = new Map<string, EditableField[]>();
  for (const field of fields) {
    const names = field.namePath;
    const attrAt = names.lastIndexOf("m_Attributes");
    const key = attrAt >= 0 && attrAt + 1 < names.length ? names.slice(0, attrAt + 2).join(".") : "";
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(field);
    groups.set(key, group);
  }
  if (groups.size === 0) {
    zeroAdjacent(fields, warnings, entity);
    return;
  }
  for (const group of groups.values()) {
    const def = group.find((field) => leaf(field).toLowerCase().includes("attributedefinition"));
    const defId = def ? numberOf(def.value) : null;
    if (defId === null || !STICKER_DEFS.has(defId)) continue;
    const raw = group.find((field) => leaf(field) === "m_iRawValue32");
    if (!raw) {
      warnings.push(`entity ${entity} sticker slot ${defId} has no raw value`);
      continue;
    }
    assertCosmeticWrite(leaf(raw));
    raw.valueOverride = storedInteger(raw.spec, 0);
  }
}

/** Old flat layout: definition field immediately followed by its raw value, not by initial value. */
function zeroAdjacent(fields: EditableField[], warnings: string[], entity: number): void {
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field) continue;
    const value = numberOf(field.value);
    if (!leaf(field).toLowerCase().includes("attributedefinition") || value === null || !STICKER_DEFS.has(value)) continue;
    const next = fields[index + 1];
    if (!next || leaf(next) !== "m_iRawValue32") {
      warnings.push(`entity ${entity} sticker slot ${value} has no raw value`);
      continue;
    }
    assertCosmeticWrite(leaf(next));
    next.valueOverride = storedInteger(next.spec, 0);
  }
}

function writeLength(
  record: EditableRecord,
  located: { path: number[]; names: string[] },
  length: number,
): void {
  if (record.kind !== "update" && record.kind !== "create") return;
  const spec = lengthSpec(located.names[located.names.length - 1] ?? "m_Attributes");
  const existing = (record.fields as EditableField[]).find((field) => samePath(field.path, located.path));
  if (existing) {
    existing.valueOverride = { kind: "uint", value: length };
    return;
  }
  pushAppend(record, located.path, located.names, spec, { kind: "uint", value: length });
}

function lengthSpec(name: string): FieldSpec {
  return {
    name,
    typeName: "uint32",
    encoder: null,
    bitCount: null,
    low: null,
    high: null,
    encodeFlags: null,
    signedEnum: false,
  };
}

function appendOf(located: { path: number[]; namePath: string[]; spec: FieldSpec }, value: number): FieldAppend {
  return { path: located.path, namePath: located.namePath, spec: located.spec, value: valueFor(located.spec, value) };
}

function pushAppend(
  record: EditableRecord,
  path: number[],
  namePath: string[],
  spec: FieldSpec,
  value: FieldValue,
): void {
  record.append = [...(record.append ?? []), { path, namePath, spec, value }];
}

function isVectorType(typeName: string): boolean {
  const base = typeName.split("<")[0]?.trim().replace(/\*+$/g, "") ?? "";
  return base === "CUtlVector" || base === "CNetworkUtlVectorBase";
}

function valueFor(spec: FieldSpec, value: number): FieldValue {
  const type = spec.typeName.toLowerCase();
  if (type.includes("float")) return { kind: "float", value };
  if (type.includes("uint")) return { kind: "uint", value };
  return { kind: "int", value };
}

function storedInteger(spec: FieldSpec, value: number): FieldValue {
  if (spec.typeName.toLowerCase().includes("float")) return { kind: "float", value: intBitsToFloat(value) };
  return valueFor(spec, value);
}

function rawInteger(field: EditableField): number | null {
  const value = field.valueOverride ?? field.value;
  if (value.kind === "float") return floatToIntBits(value.value);
  return numberOf(value);
}

function rawOf(state: AttrState, attr: number): number {
  return state.elements.find((element) => element?.def === attr)?.raw ?? 0;
}

function numberOf(value: FieldValue | undefined): number | null {
  if (!value) return null;
  if (value.kind === "int" || value.kind === "uint" || value.kind === "float") return value.value;
  return null;
}

function leaf(field: { namePath: string[] }): string {
  return field.namePath[field.namePath.length - 1] ?? "";
}

function pad(index: number): string {
  return String(index).padStart(4, "0");
}

function samePath(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
