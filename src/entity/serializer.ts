import type { ClassInfo, ProtoField, Serializer, SerializerField } from "../contract.js";
import { decodeProto, getBool, getBytes, getFloat, getMessages, getString, getVarint } from "../proto/codec.js";

/** Send tables or a raw flattened serializer. Keys are serializer names. */
export function parseFlattenedSerializers(body: Uint8Array): Map<string, Serializer> {
  let fields = decodeProto(body);
  if (!fields.some((field) => field.field === 2 || field.field === 3)) {
    const inner = getBytes(fields, 1);
    if (inner) fields = decodeProto(inner);
  }

  const symbols = fields
    .filter((field) => field.field === 2 && field.wire === 2)
    .map((field) => new TextDecoder("utf-8").decode(field.bytes ?? new Uint8Array()));
  const globalFields = getMessages(fields, 3).map((message) => readField(message, symbols));
  const serializers = new Map<string, Serializer>();

  for (const message of getMessages(fields, 1)) {
    const nameIndex = readVarint(message, 1);
    const name = nameIndex === undefined ? "" : (symbols[nameIndex] ?? "");
    const indexes = readFieldIndexes(message);
    serializers.set(name, {
      name,
      fields: indexes.map((index, position) => {
        const field = globalFields[index];
        if (!field) throw new Error(`serializer ${name} points at missing field ${index}`);
        return { ...field, index: position };
      }),
    });
  }
  return serializers;
}

export function parseClassInfo(body: Uint8Array): ClassInfo[] {
  return getMessages(decodeProto(body), 1).map((message) => ({
    classId: readVarint(message, 1) ?? 0,
    networkName: getString(message, 2) ?? "",
    tableName: getString(message, 3) ?? "",
  }));
}

/** Bits needed for the largest class id. Empty class lists still use one bit. */
export function classIdBits(classes: ClassInfo[]): number {
  let max = 0;
  for (const info of classes) if (info.classId > max) max = info.classId;
  if (max === 0) return 1;
  return Math.max(1, 32 - Math.clz32(max));
}

function readField(message: ProtoField[], symbols: string[]): SerializerField {
  const typeIndex = readVarint(message, 1);
  const nameIndex = readVarint(message, 2);
  const encoderIndex = readVarint(message, 10);
  const serializerIndex = readVarint(message, 7);
  const enumInfo = getMessages(message, 13)[0];
  return {
    index: 0,
    name: nameIndex === undefined ? "" : (symbols[nameIndex] ?? ""),
    typeName: typeIndex === undefined ? "" : (symbols[typeIndex] ?? ""),
    encoder: encoderIndex === undefined ? null : (symbols[encoderIndex] ?? null),
    bitCount: optionalNumber(readVarint(message, 3)),
    low: optionalNumber(getFloat(message, 4)),
    high: optionalNumber(getFloat(message, 5)),
    encodeFlags: optionalNumber(readVarint(message, 6)),
    signedEnum: enumInfo ? getBool(enumInfo, 1) === true : false,
    serializerName: serializerIndex === undefined ? null : (symbols[serializerIndex] ?? null),
  };
}

function readFieldIndexes(message: ProtoField[]): number[] {
  const indexes: number[] = [];
  for (const field of message) {
    if (field.field !== 3) continue;
    if (field.wire === 0 && field.number !== undefined) {
      indexes.push(Number(field.number));
      continue;
    }
    if (field.wire === 2 && field.bytes) indexes.push(...unpackVarints(field.bytes));
  }
  return indexes;
}

function unpackVarints(bytes: Uint8Array): number[] {
  const values: number[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let value = 0n;
    let shift = 0n;
    for (let count = 0; count < 10; count++) {
      const byte = bytes[offset];
      if (byte === undefined) throw new Error("truncated packed varint");
      offset++;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }
    values.push(Number(value));
  }
  return values;
}

function readVarint(fields: ProtoField[], field: number): number | undefined {
  const value = getVarint(fields, field);
  return value === undefined ? undefined : Number(value);
}

function optionalNumber(value: number | undefined): number | null {
  return value === undefined ? null : value;
}
