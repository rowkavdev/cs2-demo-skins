import { describe, expect, it } from "vitest";
import { BitReader } from "../src/bits/bit-reader.js";
import { BitWriter } from "../src/bits/bit-writer.js";
import {
  readBitVarS32,
  readBitVarU32,
  readBitVarU64,
  readUBitVar,
  readUBitVarFieldPath,
  writeBitVarS32,
  writeBitVarU32,
  writeBitVarU64,
  writeUBitVar,
  writeUBitVarFieldPath,
} from "../src/bits/ubit.js";

function packed(write: (writer: BitWriter) => void): { bytes: number[]; bitLength: number } {
  const writer = new BitWriter();
  write(writer);
  return { bytes: [...writer.toUint8Array()], bitLength: writer.bitLength };
}

function expectEncoding(
  write: (writer: BitWriter) => void,
  bytes: number[],
  bitLength: number,
): void {
  expect(packed(write)).toEqual({ bytes, bitLength });
}

describe("BitReader / BitWriter", () => {
  it("round-trips bits, booleans, bytes, and bigints LSB-first", () => {
    const payload = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0x01, 0xab]);
    const writer = new BitWriter();
    writer.writeBits(4, 0b1010);
    writer.writeBits(4, 0b1100);
    writer.writeBoolean(false);
    writer.writeBoolean(true);
    writer.writeBits(32, 0xffffffff);
    writer.writeBits(32, 0x80000000);
    writer.writeBits64(40, 0x1122334455n);
    writer.writeBits64(64, 0xffffffffffffffffn);
    writer.writeBytes(payload);

    const reader = new BitReader(writer.toUint8Array());
    expect(reader.byteLength).toBe(writer.toUint8Array().length);
    expect(reader.remainingBits()).toBe(reader.byteLength * 8);
    expect(reader.readBits(4)).toBe(0b1010);
    expect(reader.readBits(4)).toBe(0b1100);
    expect(reader.readBoolean()).toBe(false);
    expect(reader.readBoolean()).toBe(true);
    expect(reader.readBits(32)).toBe(0xffffffff);
    expect(reader.readBits(32)).toBe(0x80000000);
    expect(reader.readBits64(40)).toBe(0x1122334455n);
    expect(reader.readBits64(64)).toBe(0xffffffffffffffffn);
    expect(reader.readBytes(payload.length)).toEqual(payload);
    expect(reader.bitPos).toBe(writer.bitLength);
  });

  it("keeps byte identity when aligned and reads bytes that start mid-byte", () => {
    const raw = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0x01, 0xab]);
    const aligned = new BitReader(raw);
    expect(aligned.readBytes(raw.length)).toEqual(raw);

    const writer = new BitWriter();
    writer.writeBytes(raw);
    expect(writer.toUint8Array()).toEqual(raw);
    expect(writer.bitLength).toBe(raw.length * 8);

    const mid = new BitWriter();
    mid.writeBits(3, 0b101);
    mid.writeBytes(new Uint8Array([0xab, 0xcd]));
    const reader = new BitReader(mid.toUint8Array());
    expect(reader.readBits(3)).toBe(0b101);
    expect(reader.readBytes(2)).toEqual(new Uint8Array([0xab, 0xcd]));
    expect(reader.bitPos).toBe(mid.bitLength);
  });

  it("zero-pads the tail byte and matches readBits64 for widths up to 32", () => {
    const writer = new BitWriter();
    writer.writeBits(1, 1);
    expect([...writer.toUint8Array()]).toEqual([0x01]);
    expect(writer.bitLength).toBe(1);

    for (let n = 1; n <= 32; n++) {
      const ones = 0xffffffff >>> (32 - n);
      const pattern = (0xa5a5a5a5 & ones) >>> 0;
      const round = new BitWriter();
      round.writeBits(n, pattern);
      const asBits = new BitReader(round.toUint8Array());
      const asWide = new BitReader(round.toUint8Array());
      expect(asBits.readBits(n)).toBe(pattern);
      expect(asWide.readBits64(n)).toBe(BigInt(pattern));
      expect(asBits.bitPos).toBe(round.bitLength);
    }

    for (let n = 1; n <= 64; n++) {
      const mask = (1n << BigInt(n)) - 1n;
      const pattern = 0xfedcba9876543210n & mask;
      const round = new BitWriter();
      round.writeBits64(n, pattern);
      const reader = new BitReader(round.toUint8Array());
      expect(reader.readBits64(n)).toBe(pattern);
      expect(reader.bitPos).toBe(round.bitLength);
    }
  });

  it("peeks and skips without losing the following bits", () => {
    const reader = new BitReader(new Uint8Array([0xf0, 0x0f]));
    expect(reader.peekBits(12)).toBe(0xff0);
    expect(reader.bitPos).toBe(0);
    expect(reader.remainingBits()).toBe(16);
    reader.skipBits(4);
    expect(reader.readBits(8)).toBe(0xff);
    expect(reader.bitPos).toBe(12);
    expect(reader.peekBits(4)).toBe(0);
    expect(reader.readBits(4)).toBe(0);
  });

  it("repacks slices and writes them back at a new alignment", () => {
    const raw = new Uint8Array([0x13, 0x37, 0x80]);
    const reader = new BitReader(raw);
    const whole = reader.sliceBits(0, raw.length * 8);
    expect(whole.bitLength).toBe(24);
    expect(whole.bytes).toEqual(raw);
    expect(reader.bitPos).toBe(0);

    const crossed = new BitReader(new Uint8Array([0xf0, 0x0f]));
    const mid = crossed.sliceBits(4, 12);
    expect(mid.bitLength).toBe(8);
    expect([...mid.bytes]).toEqual([0xff]);
    const nibble = crossed.sliceBits(6, 10);
    expect(nibble.bitLength).toBe(4);
    expect([...nibble.bytes]).toEqual([0x0f]);

    const writer = new BitWriter();
    writer.writeBit(1);
    writer.writeSlice(nibble);
    writer.writeSlice(mid);
    const again = new BitReader(writer.toUint8Array());
    expect(again.readBit()).toBe(1);
    expect(again.readBits(4)).toBe(0x0f);
    expect(again.readBits(8)).toBe(0xff);
    expect(again.bitPos).toBe(writer.bitLength);

    const empty = new BitWriter();
    expect(empty.bitLength).toBe(0);
    expect(empty.toUint8Array()).toEqual(new Uint8Array());
    empty.writeSlice(reader.sliceBits(8, 8));
    expect(empty.bitLength).toBe(0);
  });

  it("refuses to read, peek, skip, or slice past the buffer", () => {
    const reader = new BitReader(new Uint8Array([0xff]));
    expect(() => reader.readBits(9)).toThrow(RangeError);
    expect(() => reader.peekBits(9)).toThrow(RangeError);
    expect(() => reader.skipBits(9)).toThrow(RangeError);
    expect(() => reader.sliceBits(0, 9)).toThrow(RangeError);
    expect(() => reader.sliceBits(2, 1)).toThrow(RangeError);
    expect(() => reader.sliceBits(-1, 1)).toThrow(RangeError);
    expect(reader.bitPos).toBe(0);
    expect(reader.readBits(8)).toBe(0xff);
    expect(() => reader.readBit()).toThrow(RangeError);
    expect(reader.bitPos).toBe(8);

    const empty = new BitReader(new Uint8Array());
    expect(empty.byteLength).toBe(0);
    expect(empty.remainingBits()).toBe(0);
    expect(() => empty.readBit()).toThrow(RangeError);
  });
});

describe("varints", () => {
  const ubitValues = [0, 1, 15, 16, 63, 64, 255, 256, 309, 4095, 4096, 0x7fffffff, 0x80000000, 0xffffffff];
  const fieldPathValues = [0, 1, 3, 4, 15, 16, 63, 64, 309, 1023, 1024, 131071, 131072, 0x7fffffff];
  const u32Values = [0, 1, 15, 16, 63, 64, 127, 128, 309, 0x7fffffff, 0x80000000, 0xffffffff];
  const s32Values = [0, 1, 15, 16, 63, 64, 309, -1, -2, -309, 2147483647, -2147483648];
  const u64Values = [0n, 1n, 15n, 16n, 63n, 64n, 127n, 128n, 309n, 0xffffffffn, 0x100000000n, 0x8000000000000000n, 0xffffffffffffffffn];

  function atAlignments(writeValue: (writer: BitWriter) => void, readValue: (reader: BitReader) => void): void {
    for (let align = 0; align < 8; align++) {
      const writer = new BitWriter();
      const prefix = align === 0 ? 0 : (1 << align) - 1;
      if (align > 0) writer.writeBits(align, prefix);
      writeValue(writer);
      const reader = new BitReader(writer.toUint8Array());
      if (align > 0) expect(reader.readBits(align)).toBe(prefix);
      readValue(reader);
      expect(reader.bitPos).toBe(writer.bitLength);
    }
  }

  it("round-trips UBitVar, including mid-byte alignment", () => {
    expectEncoding((writer) => writeUBitVar(writer, 0), [0x00], 6);
    expectEncoding((writer) => writeUBitVar(writer, 1), [0x01], 6);
    expectEncoding((writer) => writeUBitVar(writer, 15), [0x0f], 6);
    expectEncoding((writer) => writeUBitVar(writer, 16), [0x50, 0x00], 10);
    expectEncoding((writer) => writeUBitVar(writer, 63), [0xdf, 0x00], 10);
    expectEncoding((writer) => writeUBitVar(writer, 64), [0x10, 0x01], 10);
    expectEncoding((writer) => writeUBitVar(writer, 309), [0xe5, 0x04], 14);
    expectEncoding((writer) => writeUBitVar(writer, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x03], 34);

    for (const value of ubitValues) {
      atAlignments(
        (writer) => writeUBitVar(writer, value),
        (reader) => expect(readUBitVar(reader)).toBe(value),
      );
    }

    const writer = new BitWriter();
    writer.writeBits(3, 0b101);
    for (const value of ubitValues) writeUBitVar(writer, value);
    const reader = new BitReader(writer.toUint8Array());
    expect(reader.readBits(3)).toBe(0b101);
    for (const value of ubitValues) expect(readUBitVar(reader)).toBe(value);
    expect(reader.bitPos).toBe(writer.bitLength);
  });

  it("round-trips UBitVarFieldPath and rejects a 32-bit value", () => {
    expectEncoding((writer) => writeUBitVarFieldPath(writer, 0), [0x01], 3);
    expectEncoding((writer) => writeUBitVarFieldPath(writer, 3), [0x07], 3);
    expectEncoding((writer) => writeUBitVarFieldPath(writer, 4), [0x12], 6);
    expectEncoding((writer) => writeUBitVarFieldPath(writer, 309), [0xac, 0x09], 13);
    expectEncoding((writer) => writeUBitVarFieldPath(writer, 1024), [0x08, 0x40, 0x00], 21);
    expectEncoding((writer) => writeUBitVarFieldPath(writer, 131072), [0x00, 0x00, 0x20, 0x00, 0x00], 35);

    for (const value of fieldPathValues) {
      atAlignments(
        (writer) => writeUBitVarFieldPath(writer, value),
        (reader) => expect(readUBitVarFieldPath(reader)).toBe(value),
      );
    }
    expect(() => writeUBitVarFieldPath(new BitWriter(), 0xffffffff)).toThrow(RangeError);
  });

  it("round-trips unsigned and signed 32-bit varints without zigzag", () => {
    expectEncoding((writer) => writeBitVarU32(writer, 0), [0x00], 8);
    expectEncoding((writer) => writeBitVarU32(writer, 1), [0x01], 8);
    expectEncoding((writer) => writeBitVarU32(writer, 127), [0x7f], 8);
    expectEncoding((writer) => writeBitVarU32(writer, 128), [0x80, 0x01], 16);
    expectEncoding((writer) => writeBitVarU32(writer, 309), [0xb5, 0x02], 16);
    expectEncoding((writer) => writeBitVarU32(writer, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x0f], 40);
    expectEncoding((writer) => writeBitVarS32(writer, -1), [0xff, 0xff, 0xff, 0xff, 0x0f], 40);
    expectEncoding((writer) => writeBitVarS32(writer, 1), [0x01], 8);

    for (const value of u32Values) {
      atAlignments(
        (writer) => writeBitVarU32(writer, value),
        (reader) => expect(readBitVarU32(reader)).toBe(value),
      );
    }
    for (const value of s32Values) {
      atAlignments(
        (writer) => writeBitVarS32(writer, value),
        (reader) => expect(readBitVarS32(reader)).toBe(value),
      );
    }

    const continued = new BitReader(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x8f]));
    expect(readBitVarU32(continued)).toBe(0xf0000000);
    expect(continued.bitPos).toBe(40);
    const signed = new BitReader(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x8f]));
    expect(readBitVarS32(signed)).toBe(0xf0000000 | 0);
    expect(() => readBitVarU32(new BitReader(new Uint8Array([0x80])))).toThrow(RangeError);

    const writer = new BitWriter();
    writer.writeBits(3, 0b101);
    for (const value of u32Values) writeBitVarU32(writer, value);
    for (const value of s32Values) writeBitVarS32(writer, value);
    const reader = new BitReader(writer.toUint8Array());
    expect(reader.readBits(3)).toBe(0b101);
    for (const value of u32Values) expect(readBitVarU32(reader)).toBe(value);
    for (const value of s32Values) expect(readBitVarS32(reader)).toBe(value);
    expect(reader.bitPos).toBe(writer.bitLength);
  });

  it("round-trips 64-bit varints, including values above 32 bits", () => {
    expectEncoding((writer) => writeBitVarU64(writer, 309n), [0xb5, 0x02], 16);
    expectEncoding((writer) => writeBitVarU64(writer, 0x100000000n), [0x80, 0x80, 0x80, 0x80, 0x10], 40);
    expectEncoding(
      (writer) => writeBitVarU64(writer, 1n << 63n),
      [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01],
      80,
    );
    expectEncoding(
      (writer) => writeBitVarU64(writer, 0xffffffffffffffffn),
      [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01],
      80,
    );

    for (const value of u64Values) {
      atAlignments(
        (writer) => writeBitVarU64(writer, value),
        (reader) => expect(readBitVarU64(reader)).toBe(value),
      );
    }

    const ten = new Uint8Array(10).fill(0x80);
    const stopped = new BitReader(ten);
    expect(readBitVarU64(stopped)).toBe(0n);
    expect(stopped.bitPos).toBe(80);

    const writer = new BitWriter();
    writer.writeBits(1, 1);
    for (const value of u64Values) writeBitVarU64(writer, value);
    const reader = new BitReader(writer.toUint8Array());
    expect(reader.readBit()).toBe(1);
    for (const value of u64Values) expect(readBitVarU64(reader)).toBe(value);
    expect(reader.bitPos).toBe(writer.bitLength);
  });
});
