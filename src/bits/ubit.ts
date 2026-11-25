import { BitReader } from "./bit-reader.js";
import { BitWriter } from "./bit-writer.js";

const UINT32_MAX = 0xffffffff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const UINT64_MAX = 0xffffffffffffffffn;

/**
 * Source 2 UBitVar. The top two bits of the first 6 select the extra payload:
 * 00 keeps the 6-bit value, 01 reads 4 more, 10 reads 8 more, 11 reads 28 more.
 * The low 4 bits of the header are the low 4 bits of the value.
 */
export function readUBitVar(reader: BitReader): number {
  const ret = reader.readBits(6);
  switch (ret & 48) {
    case 16:
      return (ret & 15) | (reader.readBits(4) << 4);
    case 32:
      return ((ret & 15) | (reader.readBits(8) << 4)) >>> 0;
    case 48:
      return ((ret & 15) | (reader.readBits(28) << 4)) >>> 0;
    default:
      return ret;
  }
}

export function writeUBitVar(writer: BitWriter, value: number): void {
  assertRange(value, 0, UINT32_MAX, "writeUBitVar");
  const v = value >>> 0;
  if (v < 0x10) {
    writer.writeBits(6, v);
  } else if (v < 0x100) {
    writer.writeBits(6, (v & 0xf) | 16);
    writer.writeBits(4, v >>> 4);
  } else if (v < 0x1000) {
    writer.writeBits(6, (v & 0xf) | 32);
    writer.writeBits(8, v >>> 4);
  } else {
    writer.writeBits(6, (v & 0xf) | 48);
    writer.writeBits(28, v >>> 4);
  }
}

/** Field-path ubitvar: a unary prefix selects 2, 4, 10, 17, or 31 bits. */
export function readUBitVarFieldPath(reader: BitReader): number {
  if (reader.readBit() === 1) return reader.readBits(2);
  if (reader.readBit() === 1) return reader.readBits(4);
  if (reader.readBit() === 1) return reader.readBits(10);
  if (reader.readBit() === 1) return reader.readBits(17);
  return reader.readBits(31);
}

export function writeUBitVarFieldPath(writer: BitWriter, value: number): void {
  assertRange(value, 0, 0x7fffffff, "writeUBitVarFieldPath");
  if (value < 1 << 2) {
    writer.writeBit(1);
    writer.writeBits(2, value);
  } else if (value < 1 << 4) {
    writer.writeBit(0);
    writer.writeBit(1);
    writer.writeBits(4, value);
  } else if (value < 1 << 10) {
    writer.writeBit(0);
    writer.writeBit(0);
    writer.writeBit(1);
    writer.writeBits(10, value);
  } else if (value < 1 << 17) {
    writer.writeBit(0);
    writer.writeBit(0);
    writer.writeBit(0);
    writer.writeBit(1);
    writer.writeBits(17, value);
  } else {
    writer.writeBit(0);
    writer.writeBit(0);
    writer.writeBit(0);
    writer.writeBit(0);
    writer.writeBits(31, value);
  }
}

/** Protobuf-style unsigned varint, each group taken from the bitstream. At most 5 bytes. */
export function readBitVarU32(reader: BitReader): number {
  return Number(readBitVar(reader, 5) & BigInt(UINT32_MAX));
}

export function writeBitVarU32(writer: BitWriter, value: number): void {
  assertRange(value, 0, UINT32_MAX, "writeBitVarU32");
  writeBitVar(writer, BigInt(value), 5);
}

/** Same bits as `readBitVarU32`, interpreted as an int32. Not zigzag. */
export function readBitVarS32(reader: BitReader): number {
  return Number(readBitVar(reader, 5) & BigInt(UINT32_MAX)) | 0;
}

/** Writes the int32 bit pattern. Negatives take the full 32-bit varint, not a zigzag. */
export function writeBitVarS32(writer: BitWriter, value: number): void {
  assertRange(value, INT32_MIN, INT32_MAX, "writeBitVarS32");
  writeBitVar(writer, BigInt(value >>> 0), 5);
}

/** Protobuf-style unsigned varint of up to 10 groups. */
export function readBitVarU64(reader: BitReader): bigint {
  return readBitVar(reader, 10) & UINT64_MAX;
}

export function writeBitVarU64(writer: BitWriter, value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > UINT64_MAX) {
    throw new RangeError("writeBitVarU64 out of range");
  }
  writeBitVar(writer, value, 10);
}

function readBitVar(reader: BitReader, maxBytes: number): bigint {
  let result = 0n;
  for (let i = 0; i < maxBytes; i++) {
    const byte = reader.readBits(8);
    result |= BigInt(byte & 0x7f) << BigInt(7 * i);
    if ((byte & 0x80) === 0) break;
  }
  return result;
}

function writeBitVar(writer: BitWriter, value: bigint, maxBytes: number): void {
  let v = value;
  for (let i = 0; i < maxBytes; i++) {
    const group = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      writer.writeBits(8, group);
      return;
    }
    writer.writeBits(8, group | 0x80);
  }
  throw new RangeError("varint does not fit");
}

function assertRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name}(${value})`);
  }
}
