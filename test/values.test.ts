import { describe, expect, it } from "vitest";
import { BitReader } from "../src/bits/bit-reader.js";
import { BitWriter } from "../src/bits/bit-writer.js";
import type { FieldSpec, FieldValue } from "../src/contract.js";
import { readFieldValue, writeFieldValue } from "../src/entity/values.js";

function field(partial: Partial<FieldSpec> & Pick<FieldSpec, "typeName">): FieldSpec {
  return {
    name: partial.name ?? "field",
    typeName: partial.typeName,
    encoder: partial.encoder ?? null,
    bitCount: partial.bitCount ?? null,
    low: partial.low ?? null,
    high: partial.high ?? null,
    encodeFlags: partial.encodeFlags ?? null,
    signedEnum: partial.signedEnum ?? false,
  };
}

function f32(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getFloat32(0, true);
}

function roundTrip(spec: FieldSpec, value: FieldValue): { value: FieldValue; bitLength: number } {
  const writer = new BitWriter();
  writeFieldValue(writer, spec, value);
  const decoded = readFieldValue(new BitReader(writer.toUint8Array()), spec);
  expect(decoded.bitLength).toBe(writer.bitLength);
  expect(decoded.value).toEqual(value);
  return decoded;
}

describe("field values", () => {
  const int32 = field({ name: "m_nFallbackPaintKit", typeName: "int32" });
  const uint32 = field({ name: "m_OriginalOwnerXuidLow", typeName: "uint32" });
  const wear = field({ name: "m_flFallbackWear", typeName: "float32" });
  const quant = field({
    name: "m_flQuantized",
    typeName: "float32",
    bitCount: 8,
    low: 0,
    high: 1,
  });

  it("round-trips bool as one bit", () => {
    const spec = field({ typeName: "bool" });
    for (const value of [false, true]) {
      const decoded = roundTrip(spec, { kind: "bool", value });
      expect(decoded.bitLength).toBe(1);
    }
  });

  it("round-trips int32 varints including negatives", () => {
    for (const value of [0, 38, 309, 1024, -1]) {
      const decoded = roundTrip(int32, { kind: "int", value });
      expect(decoded.value).toEqual({ kind: "int", value });
    }
    const writer = new BitWriter();
    writeFieldValue(writer, int32, { kind: "int", value: -1 });
    expect(writer.bitLength).toBe(40);
    writeFieldValue(writer, int32, { kind: "int", value: 0 });
    const reader = new BitReader(writer.toUint8Array());
    expect(readFieldValue(reader, int32)).toEqual({
      value: { kind: "int", value: -1 },
      bitLength: 40,
    });
    expect(readFieldValue(reader, int32)).toEqual({
      value: { kind: "int", value: 0 },
      bitLength: 8,
    });
  });

  it("round-trips uint32 varints", () => {
    for (const value of [0, 38, 309, 1024, 0xffffffff]) {
      roundTrip(uint32, { kind: "uint", value });
    }
  });

  it("round-trips a signed enum as a signed varint", () => {
    const spec = field({ typeName: "ItemFlagTypes_t", signedEnum: true });
    roundTrip(spec, { kind: "int", value: -1 });
    roundTrip(spec, { kind: "int", value: 4 });
  });

  it("round-trips float32 wear values", () => {
    for (const value of [0, 0.07, 1]) {
      const writer = new BitWriter();
      writeFieldValue(writer, wear, { kind: "float", value });
      const decoded = readFieldValue(new BitReader(writer.toUint8Array()), wear);
      expect(decoded.bitLength).toBe(32);
      expect(decoded.value).toEqual({ kind: "float", value: f32(value) });
      roundTrip(wear, decoded.value);
    }
  });

  it("round-trips fixed8 signed and unsigned", () => {
    const signed = field({ typeName: "int8", encoder: "fixed8" });
    const unsigned = field({ typeName: "uint8", encoder: "fixed8" });
    expect(roundTrip(signed, { kind: "int", value: 0 }).bitLength).toBe(8);
    expect(roundTrip(signed, { kind: "int", value: 127 }).bitLength).toBe(8);
    expect(roundTrip(signed, { kind: "int", value: -1 }).bitLength).toBe(8);
    expect(roundTrip(signed, { kind: "int", value: -128 }).bitLength).toBe(8);
    expect(roundTrip(unsigned, { kind: "uint", value: 0 }).value).toEqual({ kind: "uint", value: 0 });
    expect(roundTrip(unsigned, { kind: "uint", value: 255 }).value).toEqual({
      kind: "uint",
      value: 255,
    });
    roundTrip(field({ typeName: "int16", encoder: "fixed16" }), { kind: "int", value: -2 });
    roundTrip(field({ typeName: "uint32", encoder: "fixed32" }), {
      kind: "uint",
      value: 0xffffffff,
    });
    roundTrip(field({ typeName: "int32", encoder: "fixed32" }), {
      kind: "int",
      value: -2147483648,
    });
  });

  it("round-trips latin1 CUtlString including a terminating NUL", () => {
    const spec = field({ typeName: "CUtlString" });
    const text = "ak\u00ff";
    const decoded = roundTrip(spec, { kind: "string", value: text });
    expect(decoded.bitLength).toBe((text.length + 1) * 8);

    const writer = new BitWriter();
    writeFieldValue(writer, spec, { kind: "string", value: "\u00ff" });
    expect(writer.bitLength).toBe(16);
    writeFieldValue(writer, field({ typeName: "bool" }), { kind: "bool", value: true });
    const reader = new BitReader(writer.toUint8Array());
    expect(readFieldValue(reader, spec)).toEqual({
      value: { kind: "string", value: "\u00ff" },
      bitLength: 16,
    });
    expect(readFieldValue(reader, field({ typeName: "bool" }))).toEqual({
      value: { kind: "bool", value: true },
      bitLength: 1,
    });

    roundTrip(field({ typeName: "CUtlString" }), { kind: "string", value: "" });
    roundTrip(field({ typeName: "char*" }), { kind: "string", value: "rifle" });
    roundTrip(field({ typeName: "CUtlSymbolLarge" }), { kind: "string", value: "hi" });
  });

  it("round-trips a quantized float on an 8-bit 0..1 range", () => {
    for (const u of [0, 1, 18, 128, 255]) {
      const value = u / 255;
      const decoded = roundTrip(quant, { kind: "float", value });
      expect(decoded.bitLength).toBe(8);
    }
    const networked = field({
      typeName: "CNetworkedQuantizedFloat",
      bitCount: 8,
      low: 0,
      high: 1,
    });
    roundTrip(networked, { kind: "float", value: 0 });
    roundTrip(networked, { kind: "float", value: 1 });
  });

  it("reads a quantized endpoint from its flag bit", () => {
    const spec = field({
      typeName: "float32",
      bitCount: 8,
      low: 0,
      high: 1,
      encodeFlags: 1,
    });
    const low = roundTrip(spec, { kind: "float", value: 0 });
    expect(low.bitLength).toBe(1);
    const high = roundTrip(spec, { kind: "float", value: 1 });
    expect(high.bitLength).toBe(9);
  });

  it("decodes a value that does not start on a byte boundary", () => {
    const writer = new BitWriter();
    writer.writeBits(3, 0b101);
    writeFieldValue(writer, int32, { kind: "int", value: 309 });
    const reader = new BitReader(writer.toUint8Array());
    expect(reader.readBits(3)).toBe(0b101);
    expect(readFieldValue(reader, int32).value).toEqual({ kind: "int", value: 309 });
  });

  it("throws UnknownFieldEncoding for an unsupported type", () => {
    const spec = field({ typeName: "MysteryBlob", encoder: "coord" });
    const writer = new BitWriter();
    expect(() => writeFieldValue(writer, spec, { kind: "uint", value: 1 })).toThrowError(
      /MysteryBlob/,
    );
    try {
      readFieldValue(new BitReader(new Uint8Array(1)), spec);
      expect.fail("read should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("UnknownFieldEncoding");
      expect((error as Error).message).toContain("MysteryBlob");
      expect((error as Error).message).toContain("coord");
    }
  });
});
