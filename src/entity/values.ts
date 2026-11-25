import { BitReader } from "../bits/bit-reader.js";
import { BitWriter } from "../bits/bit-writer.js";
import {
  readBitVarS32,
  readBitVarU32,
  readBitVarU64,
  writeBitVarS32,
  writeBitVarU32,
  writeBitVarU64,
} from "../bits/ubit.js";
import type { FieldSpec, FieldValue } from "../contract.js";

/** Quantized-float encode flags. Bit 3 (encode integers) does not change the wire formula. */
const ROUND_DOWN = 1 << 0;
const ROUND_UP = 1 << 1;
const ENCODE_ZERO = 1 << 2;

const UINT32_BASES = new Set([
  "CHandle",
  "CEntityHandle",
  "CUtlStringToken",
  "color32",
]);

type Encoding =
  | { op: "fixed"; bits: number; signed: boolean }
  | { op: "u64var" }
  | { op: "bool" }
  | { op: "svar" }
  | { op: "uvar" }
  | { op: "f32" }
  | { op: "quant"; bitCount: number; low: number; high: number; flags: number }
  | { op: "string" }
  | { op: "vec"; count: number }
  | { op: "normal" };

function unknownFieldEncoding(spec: FieldSpec): Error {
  const error = new Error(
    `Unknown field encoding for type "${spec.typeName}" encoder ${spec.encoder ?? "null"}`,
  );
  error.name = "UnknownFieldEncoding";
  return error;
}

function baseTypeName(typeName: string): string {
  let name = typeName.trim();
  const generic = name.indexOf("<");
  if (generic !== -1) name = name.slice(0, generic);
  const bracket = name.indexOf("[");
  if (bracket !== -1) name = name.slice(0, bracket);
  return name.replace(/[\s*]+$/g, "").trim();
}

function isSignedIntegerName(base: string): boolean {
  return base.startsWith("int") && !base.startsWith("uint");
}

function unsignedVarWidth(base: string): 32 | 64 | null {
  if (!/^uint\d+$/.test(base)) return null;
  return Number(base.slice(4)) >= 64 ? 64 : 32;
}

function isStringType(typeName: string, base: string): boolean {
  if (base === "string" || base === "CUtlString" || base === "CUtlSymbolLarge") return true;
  return base === "char" && typeName.includes("*");
}

/** Vector and QAngle aggregates. CUtlVector is a container, not three floats. */
function isFloatAggregate(base: string): boolean {
  if (base.startsWith("CUtl")) return false;
  return base.includes("Vector") || base.includes("QAngle");
}

function quantOrFloat(spec: FieldSpec, base: string): Encoding | null {
  const quantizedType = base === "CNetworkedQuantizedFloat";
  const floatType = base === "float32";
  if (!quantizedType && !floatType) return null;
  const bitCount = spec.bitCount;
  if (bitCount === null || bitCount <= 0 || bitCount >= 32) return { op: "f32" };
  return {
    op: "quant",
    bitCount,
    low: spec.low ?? 0,
    high: spec.high ?? 1,
    flags: spec.encodeFlags ?? 0,
  };
}

/** First match wins, in the order specified for field values. */
function encodingOf(spec: FieldSpec): Encoding {
  const base = baseTypeName(spec.typeName);
  const encoder = spec.encoder;
  if (encoder === "fixed8" || encoder === "fixed16" || encoder === "fixed32") {
    const bits = encoder === "fixed8" ? 8 : encoder === "fixed16" ? 16 : 32;
    return { op: "fixed", bits, signed: isSignedIntegerName(base) };
  }
  // fixed64 is a bit-packed varint, not 64 raw bits.
  if (encoder === "fixed64") return { op: "u64var" };
  if (base === "bool") return { op: "bool" };
  if (isSignedIntegerName(base) || spec.signedEnum) return { op: "svar" };
  const width = unsignedVarWidth(base);
  if (width === 64) return { op: "u64var" };
  if (width === 32 || UINT32_BASES.has(base)) return { op: "uvar" };
  const floated = quantOrFloat(spec, base);
  if (floated) return floated;
  if (isStringType(spec.typeName, base)) return { op: "string" };
  if (isFloatAggregate(base)) {
    if (encoder === "normal") return { op: "normal" };
    if (encoder === "qangle_pitch_yaw") return { op: "vec", count: 2 };
    return { op: "vec", count: 3 };
  }
  throw unknownFieldEncoding(spec);
}

function readFloat32(reader: BitReader): number {
  const bits = reader.readBits(32) >>> 0;
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits, true);
  return view.getFloat32(0, true);
}

function writeFloat32(writer: BitWriter, value: number): void {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  writer.writeBits(32, view.getUint32(0, true));
}

function signExtend(unsigned: number, bits: number): number {
  if (bits >= 32) return unsigned | 0;
  const sign = 2 ** (bits - 1);
  if (unsigned & sign) return unsigned - 2 ** bits;
  return unsigned;
}

function lowBits(value: number, bits: number): number {
  if (bits >= 32) return value >>> 0;
  return value & (2 ** bits - 1);
}

function readQuantized(
  reader: BitReader,
  bitCount: number,
  low: number,
  high: number,
  flags: number,
): number {
  if ((flags & ROUND_DOWN) !== 0 && reader.readBoolean()) return low;
  if ((flags & ROUND_UP) !== 0 && reader.readBoolean()) return high;
  if ((flags & ENCODE_ZERO) !== 0 && reader.readBoolean()) return 0;
  const u = reader.readBits(bitCount);
  const levels = 2 ** bitCount - 1;
  return low + ((high - low) * u) / levels;
}

function quantize(value: number, low: number, high: number, bitCount: number): number {
  const levels = 2 ** bitCount - 1;
  const span = high - low;
  if (!(span !== 0) || !Number.isFinite(value)) return 0;
  let u = Math.round(((value - low) / span) * levels);
  if (!Number.isFinite(u) || u < 0) u = 0;
  else if (u > levels) u = levels;
  return u;
}

function writeQuantized(
  writer: BitWriter,
  value: number,
  bitCount: number,
  low: number,
  high: number,
  flags: number,
): void {
  if ((flags & ROUND_DOWN) !== 0) {
    if (value === low) {
      writer.writeBoolean(true);
      return;
    }
    writer.writeBoolean(false);
  }
  if ((flags & ROUND_UP) !== 0) {
    if (value === high) {
      writer.writeBoolean(true);
      return;
    }
    writer.writeBoolean(false);
  }
  if ((flags & ENCODE_ZERO) !== 0) {
    if (value === 0) {
      writer.writeBoolean(true);
      return;
    }
    writer.writeBoolean(false);
  }
  writer.writeBits(bitCount, quantize(value, low, high, bitCount));
}

function readLatin1(reader: BitReader): string {
  const bytes: number[] = [];
  for (;;) {
    const byte = reader.readBits(8);
    if (byte === 0) break;
    bytes.push(byte);
  }
  return new TextDecoder("latin1").decode(Uint8Array.from(bytes));
}

function writeLatin1(writer: BitWriter, value: string): void {
  for (let i = 0; i < value.length; i++) writer.writeBits(8, value.charCodeAt(i) & 0xff);
  writer.writeBits(8, 0);
}

function readNormal(reader: BitReader): number[] {
  const x = readFloat32(reader);
  const y = readFloat32(reader);
  const negative = reader.readBoolean();
  const prod = Math.min(1, x * x + y * y);
  const z = Math.sqrt(1 - prod) * (negative ? -1 : 1);
  return [x, y, z];
}

function writeNormal(writer: BitWriter, value: number[]): void {
  const x = value[0] ?? 0;
  const y = value[1] ?? 0;
  const z = value[2] ?? 0;
  writeFloat32(writer, x);
  writeFloat32(writer, y);
  writer.writeBoolean(z < 0);
}

function asNumber(value: FieldValue): number {
  switch (value.kind) {
    case "int":
    case "uint":
    case "float":
      return value.value;
    case "uint64":
      return Number(value.value);
    case "bool":
      return value.value ? 1 : 0;
    default:
      throw new Error(`expected a numeric field value, got ${value.kind}`);
  }
}

function asBigInt(value: FieldValue): bigint {
  switch (value.kind) {
    case "uint64":
      return value.value;
    case "int":
    case "uint":
      return BigInt(value.value);
    default:
      throw new Error(`expected an integer field value, got ${value.kind}`);
  }
}

function asString(value: FieldValue): string {
  if (value.kind !== "string") throw new Error(`expected a string field value, got ${value.kind}`);
  return value.value;
}

function asVector(value: FieldValue): number[] {
  if (value.kind !== "vector") throw new Error(`expected a vector field value, got ${value.kind}`);
  return value.value;
}

function readU64(reader: BitReader): bigint {
  return readBitVarU64(reader);
}

function readEncoded(reader: BitReader, spec: FieldSpec): FieldValue {
  const encoding = encodingOf(spec);
  switch (encoding.op) {
    case "fixed": {
      const unsigned = reader.readBits(encoding.bits) >>> 0;
      if (encoding.signed) return { kind: "int", value: signExtend(unsigned, encoding.bits) };
      return { kind: "uint", value: unsigned };
    }
    case "u64var":
      return { kind: "uint64", value: readU64(reader) };
    case "bool":
      return { kind: "bool", value: reader.readBoolean() };
    case "svar":
      // readBitVarS32 is an int32 pattern, so the value always fits in `int`.
      return { kind: "int", value: readBitVarS32(reader) | 0 };
    case "uvar":
      return { kind: "uint", value: readBitVarU32(reader) >>> 0 };
    case "f32":
      return { kind: "float", value: readFloat32(reader) };
    case "quant":
      return {
        kind: "float",
        value: readQuantized(reader, encoding.bitCount, encoding.low, encoding.high, encoding.flags),
      };
    case "string":
      return { kind: "string", value: readLatin1(reader) };
    case "vec":
      return {
        kind: "vector",
        value: Array.from({ length: encoding.count }, () => readFloat32(reader)),
      };
    case "normal":
      return { kind: "vector", value: readNormal(reader) };
  }
}

function writeEncoded(writer: BitWriter, spec: FieldSpec, value: FieldValue): void {
  const encoding = encodingOf(spec);
  switch (encoding.op) {
    case "fixed":
      writer.writeBits(encoding.bits, lowBits(asNumber(value), encoding.bits));
      return;
    case "u64var":
      writeBitVarU64(writer, asBigInt(value));
      return;
    case "bool":
      if (value.kind !== "bool") throw new Error(`expected a bool field value, got ${value.kind}`);
      writer.writeBoolean(value.value);
      return;
    case "svar":
      writeBitVarS32(writer, asNumber(value) | 0);
      return;
    case "uvar":
      writeBitVarU32(writer, asNumber(value) >>> 0);
      return;
    case "f32":
      writeFloat32(writer, asNumber(value));
      return;
    case "quant":
      writeQuantized(writer, asNumber(value), encoding.bitCount, encoding.low, encoding.high, encoding.flags);
      return;
    case "string":
      writeLatin1(writer, asString(value));
      return;
    case "vec": {
      const components = asVector(value);
      if (components.length < encoding.count) {
        throw new Error(`expected ${encoding.count} vector components, got ${components.length}`);
      }
      for (let i = 0; i < encoding.count; i++) writeFloat32(writer, components[i] ?? 0);
      return;
    }
    case "normal":
      writeNormal(writer, asVector(value));
      return;
  }
}

export function readFieldValue(
  reader: BitReader,
  spec: FieldSpec,
): { value: FieldValue; bitLength: number } {
  const start = reader.bitPos;
  const value = readEncoded(reader, spec);
  return { value, bitLength: reader.bitPos - start };
}

export function writeFieldValue(writer: BitWriter, spec: FieldSpec, value: FieldValue): void {
  writeEncoded(writer, spec, value);
}
