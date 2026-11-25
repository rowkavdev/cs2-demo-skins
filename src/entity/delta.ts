import { BitReader } from "../bits/bit-reader.js";
import { BitWriter } from "../bits/bit-writer.js";
import { readBitVarU32, readUBitVar, writeBitVarU32, writeUBitVar } from "../bits/ubit.js";
import type {
  BitSlice,
  ClassInfo,
  DecodedField,
  EntityRecord,
  FieldPath,
  FieldSpec,
  FieldValue,
  Serializer,
} from "../contract.js";
import { SVC_PACKET_ENTITIES } from "../contract.js";
import { decodeFieldPaths, encodeFieldPaths, stepFieldPath } from "./field-path.js";
import { readFieldValue, writeFieldValue } from "./values.js";
import { decodeProto, encodeProto, getBytes, getMessages, getString, getVarint, replaceBytes, replaceVarint } from "../proto/codec.js";

const UPDATE = 0;
const LEAVE = 1;
const CREATE = 2;
const DELETE = 3;

export type EditableField = DecodedField & { valueOverride?: FieldValue };

export type FieldAppend = {
  path: FieldPath;
  namePath: string[];
  spec: FieldSpec;
  value: FieldValue;
};

export type RecordEncoding = {
  pathBits: BitSlice;
  /** Bit offset of the finish op inside `pathBits`. */
  finishBit: number;
  pvsBits: BitSlice | null;
};

export type EditableRecord = EntityRecord & {
  encoding?: RecordEncoding;
  append?: FieldAppend[];
};

export type PacketContext = {
  classBits: number;
  classes: ClassInfo[];
  serializers: Map<string, Serializer>;
  classByIndex?: Map<number, number>;
  /** Rewrite instancebaseline rows. Time-window edits leave this false. */
  baselines?: boolean;
};

export type EntityMutator = (records: EditableRecord[]) => {
  records: EditableRecord[];
  warnings: string[];
};

const serializersByClass = new WeakMap<PacketContext, Map<number, Serializer>>();

function classMap(ctx: PacketContext): Map<number, number> {
  if (!ctx.classByIndex) ctx.classByIndex = new Map();
  return ctx.classByIndex;
}

function serializerFor(ctx: PacketContext, classId: number): Serializer | undefined {
  let cached = serializersByClass.get(ctx);
  if (!cached) {
    cached = new Map();
    for (const info of ctx.classes) {
      const serializer = ctx.serializers.get(info.networkName) ?? ctx.serializers.get(info.tableName);
      if (serializer) cached.set(info.classId, serializer);
    }
    serializersByClass.set(ctx, cached);
  }
  return cached.get(classId);
}

export function readEntityData(
  bytes: Uint8Array,
  updatedEntries: number,
  classBits: number,
  hasPvsBits: number,
  ctx: PacketContext,
): EditableRecord[] {
  const reader = new BitReader(bytes);
  const classes = classMap(ctx);
  const records: EditableRecord[] = [];
  let previous = -1;
  for (let entry = 0; entry < updatedEntries; entry++) {
    const index = previous + readUBitVar(reader) + 1;
    previous = index;
    const command = reader.readBits(2);
    if (command === LEAVE) {
      records.push({ kind: "leave", index });
      continue;
    }
    if (command === DELETE) {
      classes.delete(index);
      records.push({ kind: "delete", index });
      continue;
    }
    let classId = classes.get(index);
    let serial = 0;
    let extra = 0;
    if (command === CREATE) {
      classId = reader.readBits(classBits);
      serial = reader.readBits(17);
      extra = readBitVarU32(reader);
      classes.set(index, classId);
    } else if (command !== UPDATE) {
      throw new Error(`unknown entity command ${command}`);
    }
    const pvsBits = hasPvsBits > 0 ? reader.sliceBits(reader.bitPos, reader.bitPos + hasPvsBits) : null;
    if (hasPvsBits > 0) reader.skipBits(hasPvsBits);
    if (classId === undefined) throw new Error(`update for entity ${index} has no class`);
    const serializer = serializerFor(ctx, classId);
    if (!serializer) throw new Error(`no serializer for class ${classId}`);
    const decoded = readFieldBlock(reader, serializer, ctx.serializers);
    const record: EditableRecord =
      command === CREATE
        ? { kind: "create", index, classId, serial, extra, fields: decoded.fields, encoding: { ...decoded.encoding, pvsBits } }
        : { kind: "update", index, fields: decoded.fields, encoding: { ...decoded.encoding, pvsBits } };
    records.push(record);
  }
  return records;
}

export function writeEntityData(
  records: EditableRecord[],
  classBits: number,
  hasPvsBits: number,
  warnings: string[] = [],
): Uint8Array {
  const writer = new BitWriter();
  let previous = -1;
  for (const record of records) {
    writeUBitVar(writer, record.index - previous - 1);
    previous = record.index;
    if (record.kind === "leave") {
      writer.writeBits(2, LEAVE);
      continue;
    }
    if (record.kind === "delete") {
      writer.writeBits(2, DELETE);
      continue;
    }
    if (record.kind === "create") {
      writer.writeBits(2, CREATE);
      writer.writeBits(classBits, record.classId);
      writer.writeBits(17, record.serial);
      writeBitVarU32(writer, record.extra);
    } else {
      writer.writeBits(2, UPDATE);
    }
    if (hasPvsBits > 0) {
      if (record.encoding?.pvsBits) writer.writeSlice(record.encoding.pvsBits);
      else writer.writeBits(hasPvsBits, 0);
    }
    writeFields(writer, record, warnings);
  }
  return writer.toUint8Array();
}

export function rewritePacketEntitiesPayload(
  payload: Uint8Array,
  ctx: PacketContext,
  mutator: EntityMutator,
): { payload: Uint8Array; warnings: string[] } {
  const fields = decodeProto(payload);
  const entityData = getBytes(fields, 7);
  if (!entityData) return { payload, warnings: [] };
  const updated = Number(getVarint(fields, 2) ?? 0n);
  const pvs = Number(getVarint(fields, 16) ?? 0n);
  const records = readEntityData(entityData, updated, ctx.classBits, pvs, ctx);
  const edited = mutator(records);
  const warnings = [...edited.warnings];
  const written = writeEntityData(edited.records, ctx.classBits, pvs, warnings);
  let next = replaceBytes(fields, 7, written);
  next = replaceVarint(next, 2, BigInt(edited.records.length));
  return { payload: encodeProto(next), warnings };
}

/**
 * Rewrites packet, signon, and full-packet bodies. Other net messages are copied
 * bit for bit. Instance baselines are rewritten only when `ctx.baselines` is set.
 */
export function rewritePacketBody(
  body: Uint8Array,
  command: number,
  ctx: PacketContext,
  mutator: EntityMutator,
): { body: Uint8Array; warnings: string[] } {
  const warnings: string[] = [];
  if (command === 6 && ctx.baselines) return rewriteBaselineBody(body, ctx, mutator);
  if (command !== 7 && command !== 8 && command !== 13) return { body, warnings };

  const fields = decodeProto(body);
  if (command === 13) {
    let next = fields;
    const packet = getMessages(fields, 2)[0];
    if (packet) {
      const data = getBytes(packet, 3);
      if (data) {
        const rewritten = rewriteNetMessages(data, (payload) => rewritePacketEntitiesPayload(payload, ctx, mutator));
        warnings.push(...rewritten.warnings);
        const packetFields = replaceBytes(packet, 3, rewritten.bytes);
        next = replaceBytes(next, 2, encodeProto(packetFields));
      }
    }
    if (ctx.baselines) {
      const tables = getBytes(next, 1) ?? getMessages(next, 1)[0];
      const tableBytes = tables instanceof Uint8Array ? tables : tables ? encodeProto(tables) : undefined;
      if (tableBytes) {
        const baselines = rewriteBaselineBody(tableBytes, ctx, mutator);
        warnings.push(...baselines.warnings);
        next = replaceBytes(next, 1, baselines.body);
      }
    }
    return { body: encodeProto(next), warnings };
  }

  const data = getBytes(fields, 3);
  if (!data) return { body, warnings };
  const rewritten = rewriteNetMessages(data, (payload) => rewritePacketEntitiesPayload(payload, ctx, mutator));
  return { body: encodeProto(replaceBytes(fields, 3, rewritten.bytes)), warnings: rewritten.warnings };
}

function rewriteNetMessages(
  data: Uint8Array,
  edit: (payload: Uint8Array) => { payload: Uint8Array; warnings: string[] },
): { bytes: Uint8Array; warnings: string[] } {
  const reader = new BitReader(data);
  const writer = new BitWriter();
  const warnings: string[] = [];
  while (reader.remainingBits() > 8) {
    const start = reader.bitPos;
    const type = readUBitVar(reader);
    const size = readBitVarU32(reader);
    const payload = reader.readBytes(size);
    const end = reader.bitPos;
    if (type === SVC_PACKET_ENTITIES) {
      const edited = edit(payload);
      warnings.push(...edited.warnings);
      writeUBitVar(writer, type);
      writeBitVarU32(writer, edited.payload.length);
      writer.writeBytes(edited.payload);
      continue;
    }
    writer.writeSlice(reader.sliceBits(start, end));
  }
  const tail = reader.remainingBits();
  if (tail > 0) writer.writeSlice(reader.sliceBits(reader.bitPos, reader.bitPos + tail));
  return { bytes: writer.toUint8Array(), warnings };
}

function rewriteBaselineBody(
  body: Uint8Array,
  ctx: PacketContext,
  mutator: EntityMutator,
): { body: Uint8Array; warnings: string[] } {
  const tables = decodeProto(body);
  const warnings: string[] = [];
  let changed = false;
  const next = tables.map((field) => {
    if (field.field !== 1 || field.wire !== 2 || !field.bytes) return field;
    const table = decodeProto(field.bytes);
    if (getString(table, 1) !== "instancebaseline") return field;
    changed = true;
    return { ...field, bytes: encodeProto(rewriteBaselineTable(table, ctx, mutator, warnings)) };
  });
  return { body: changed ? encodeProto(next) : body, warnings };
}

function rewriteBaselineTable(
  table: ReturnType<typeof decodeProto>,
  ctx: PacketContext,
  mutator: EntityMutator,
  warnings: string[],
): ReturnType<typeof decodeProto> {
  return table.map((field) => {
    if (field.field !== 2 || field.wire !== 2 || !field.bytes) return field;
    const item = decodeProto(field.bytes);
    const key = getString(item, 1);
    const data = getBytes(item, 2);
    const classId = key === undefined ? Number.NaN : Number(key);
    if (!data || !Number.isInteger(classId)) return field;
    const serializer = serializerFor(ctx, classId);
    if (!serializer) {
      warnings.push(`baseline class ${key} has no serializer`);
      return field;
    }
    const reader = new BitReader(data);
    const decoded = readFieldBlock(reader, serializer, ctx.serializers);
    const record: EditableRecord = {
      kind: "create",
      index: -1,
      classId,
      serial: 0,
      extra: 0,
      fields: decoded.fields,
      encoding: { ...decoded.encoding, pvsBits: null },
    };
    const edited = mutator([record]);
    warnings.push(...edited.warnings);
    const written = new BitWriter();
    const first = edited.records[0];
    if (first && (first.kind === "create" || first.kind === "update")) writeFields(written, first, warnings);
    return { ...field, bytes: encodeProto(replaceBytes(item, 2, written.toUint8Array())) };
  });
}

function readFieldBlock(
  reader: BitReader,
  serializer: Serializer,
  serializers: Map<string, Serializer>,
): { fields: EditableField[]; encoding: RecordEncoding } {
  const pathStart = reader.bitPos;
  const decoded = decodeFieldPaths(reader);
  const pathBits = reader.sliceBits(pathStart, decoded.endBit);
  const fields: EditableField[] = [];
  for (const path of decoded.paths) {
    const resolved = resolvePath(serializer, path, serializers);
    const start = reader.bitPos;
    const value = readFieldValue(reader, resolved.spec);
    fields.push({
      path,
      namePath: resolved.namePath,
      spec: resolved.spec,
      value: value.value,
      rawBits: reader.sliceBits(start, reader.bitPos),
    });
  }
  return {
    fields,
    encoding: { pathBits, finishBit: decoded.finishBitStart - pathStart, pvsBits: null },
  };
}

function resolvePath(
  root: Serializer,
  path: FieldPath,
  serializers: Map<string, Serializer>,
): { spec: FieldSpec; namePath: string[] } {
  let current = root;
  const namePath: string[] = [];
  for (let depth = 0; depth < path.length; depth++) {
    const component = path[depth];
    if (component === undefined) break;
    const field = current.fields[component];
    if (!field) throw new Error(`field path ${path.join("/")} misses ${current.name}[${component}]`);
    namePath.push(field.name);
    const leaf = depth === path.length - 1;
    if (!field.serializerName) {
      if (!leaf) throw new Error(`field path continues past ${namePath.join(".")}`);
      return { spec: field, namePath };
    }
    const nested = serializers.get(field.serializerName);
    if (!nested) throw new Error(`missing nested serializer ${field.serializerName}`);
    if (leaf) return { spec: field, namePath };
    current = nested;
  }
  throw new Error("empty field path");
}

function writeFields(writer: BitWriter, record: EditableRecord, warnings: string[]): void {
  if (record.kind !== "update" && record.kind !== "create") return;
  const append = record.append ?? [];
  const fields = record.fields as EditableField[];
  if (append.length === 1 && record.encoding) {
    const last = fields[fields.length - 1]?.path ?? [-1];
    const step = stepFieldPath(last, append[0].path);
    if (!step) {
      warnings.push(`left entity ${record.index} unchanged; no single op reaches ${append[0].path.join("/")}`);
      writer.writeSlice(record.encoding.pathBits);
      for (const field of fields) writer.writeSlice(field.rawBits);
      return;
    }
    const prefix: BitSlice = {
      bytes: record.encoding.pathBits.bytes,
      bitLength: record.encoding.finishBit,
    };
    writer.writeSlice(prefix);
    writer.writeSlice(step);
    writer.writeSlice(encodeFieldPaths([]));
    for (const field of fields) writeOneValue(writer, field);
    writeFieldValue(writer, append[0].spec, append[0].value);
    return;
  }
  if (append.length === 0 && record.encoding) {
    writer.writeSlice(record.encoding.pathBits);
    for (const field of fields) writeOneValue(writer, field);
    return;
  }
  const paths = [...fields.map((field) => field.path), ...append.map((field) => field.path)];
  writer.writeSlice(encodeFieldPaths(paths));
  for (const field of fields) writeOneValue(writer, field);
  for (const field of append) writeFieldValue(writer, field.spec, field.value);
}

function writeOneValue(writer: BitWriter, field: EditableField): void {
  if (field.valueOverride) writeFieldValue(writer, field.spec, field.valueOverride);
  else writer.writeSlice(field.rawBits);
}
