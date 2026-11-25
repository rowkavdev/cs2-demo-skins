import { describe, expect, it } from "vitest";
import type { ProtoField } from "../src/contract.js";
import {
  decodeProto,
  encodeProto,
  getBool,
  getBytes,
  getFloat,
  getMessages,
  getString,
  getVarint,
  replaceBytes,
  replaceVarint,
} from "../src/proto/codec.js";

function floatBits(value: number): bigint {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return BigInt(view.getUint32(0, true));
}

function float32(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getFloat32(0, true);
}

describe("protobuf codec", () => {
  it("round-trips bytes, varint, float, nested message, and an unknown field across replaceBytes", () => {
    const nested = encodeProto([
      { field: 1, wire: 0, number: 309n },
      { field: 2, wire: 5, number: floatBits(0.07) },
      { field: 3, wire: 2, bytes: new TextEncoder().encode("fade") },
    ]);
    const fields: ProtoField[] = [
      { field: 1, wire: 2, bytes: new TextEncoder().encode("skin") },
      { field: 2, wire: 0, number: 150n },
      { field: 3, wire: 5, number: floatBits(1) },
      { field: 4, wire: 2, bytes: nested },
      { field: 99, wire: 1, number: 0x0102030405060708n },
    ];

    const decoded = decodeProto(encodeProto(fields));
    expect(decoded).toEqual(fields);
    expect(getString(decoded, 1)).toBe("skin");
    expect(getVarint(decoded, 2)).toBe(150n);
    expect(getFloat(decoded, 3)).toBe(1);
    const messages = getMessages(decoded, 4);
    expect(messages).toHaveLength(1);
    expect(getVarint(messages[0] ?? [], 1)).toBe(309n);
    expect(getFloat(messages[0] ?? [], 2)).toBe(float32(0.07));
    expect(getString(messages[0] ?? [], 3)).toBe("fade");

    const replaced = replaceBytes(decoded, 1, new TextEncoder().encode("asiimov"));
    const again = decodeProto(encodeProto(replaced));
    expect(again.map((item) => item.field)).toEqual([1, 2, 3, 4, 99]);
    expect(getString(again, 1)).toBe("asiimov");
    expect(getVarint(again, 2)).toBe(150n);
    expect(getFloat(again, 3)).toBe(1);
    expect(getVarint(getMessages(again, 4)[0] ?? [], 1)).toBe(309n);
    expect(getFloat(getMessages(again, 4)[0] ?? [], 2)).toBe(float32(0.07));
    expect(again.find((item) => item.field === 99)).toEqual({
      field: 99,
      wire: 1,
      number: 0x0102030405060708n,
    });
    expect(decoded[0]).toEqual({ field: 1, wire: 2, bytes: new TextEncoder().encode("skin") });
  });

  it("decodes the canonical protobuf examples", () => {
    expect(decodeProto(Uint8Array.of(0x08, 0x96, 0x01))).toEqual([
      { field: 1, wire: 0, number: 150n },
    ]);
    const testing = Uint8Array.of(0x12, 0x07, 0x74, 0x65, 0x73, 0x74, 0x69, 0x6e, 0x67);
    expect(getString(decodeProto(testing), 2)).toBe("testing");
    expect(encodeProto(decodeProto(testing))).toEqual(testing);

    const one = Uint8Array.of(0x0d, 0x00, 0x00, 0x80, 0x3f);
    expect(decodeProto(one)).toEqual([{ field: 1, wire: 5, number: 0x3f800000n }]);
    expect(getFloat(decodeProto(one), 1)).toBe(1);
    expect(encodeProto(decodeProto(one))).toEqual(one);

    const fixed64 = Uint8Array.of(0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01);
    expect(decodeProto(fixed64)).toEqual([{ field: 1, wire: 1, number: 0x0102030405060708n }]);
    expect(encodeProto(decodeProto(fixed64))).toEqual(fixed64);

    const nested = Uint8Array.of(0x1a, 0x03, 0x08, 0x96, 0x01);
    expect(getVarint(getMessages(decodeProto(nested), 3)[0] ?? [], 1)).toBe(150n);
    expect(encodeProto(decodeProto(nested))).toEqual(nested);
  });

  it("preserves field order, duplicates, and packed bytes", () => {
    const fields: ProtoField[] = [
      { field: 3, wire: 0, number: 1n },
      { field: 1, wire: 0, number: 2n },
      { field: 3, wire: 0, number: 3n },
    ];
    expect(decodeProto(encodeProto(fields))).toEqual(fields);
    expect(encodeProto(decodeProto(Uint8Array.of(0x10, 0x01, 0x08, 0x02)))).toEqual(
      Uint8Array.of(0x10, 0x01, 0x08, 0x02),
    );

    const packed = Uint8Array.of(0x22, 0x02, 0x01, 0x02);
    expect(decodeProto(packed)).toEqual([{ field: 4, wire: 2, bytes: Uint8Array.of(0x01, 0x02) }]);
    expect(encodeProto(decodeProto(packed))).toEqual(packed);

    const wideTag = Uint8Array.of(0x80, 0x01, 0x01);
    expect(decodeProto(wideTag)).toEqual([{ field: 16, wire: 0, number: 1n }]);
    expect(encodeProto(decodeProto(wideTag))).toEqual(wideTag);
  });

  it("round-trips varint boundaries and float bit patterns", () => {
    const values = [0n, 1n, 127n, 128n, 300n, 150n, (1n << 63n) - 1n, (1n << 64n) - 1n];
    for (const value of values) {
      const fields: ProtoField[] = [{ field: 8, wire: 0, number: value }];
      expect(decodeProto(encodeProto(fields))).toEqual(fields);
    }

    for (const value of [0, 1, -1, 0.07, -0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bits = floatBits(value);
      const decoded = decodeProto(encodeProto([{ field: 5, wire: 5, number: bits }]));
      expect(decoded[0]?.number).toBe(bits);
      const got = getFloat(decoded, 5);
      if (Number.isNaN(value)) expect(Number.isNaN(got)).toBe(true);
      else expect(Object.is(got, float32(value))).toBe(true);
    }
  });

  it("reads the last matching value and every submessage", () => {
    const fields: ProtoField[] = [
      { field: 1, wire: 2, bytes: Uint8Array.of(1) },
      { field: 1, wire: 2, bytes: Uint8Array.of(2, 3) },
      { field: 1, wire: 0, number: 0n },
      { field: 2, wire: 0, number: 1n },
      { field: 2, wire: 0, number: 9n },
      { field: 4, wire: 2, bytes: encodeProto([{ field: 1, wire: 0, number: 1n }]) },
      { field: 4, wire: 2, bytes: encodeProto([{ field: 1, wire: 0, number: 2n }]) },
      { field: 7, wire: 5, number: floatBits(-1) },
    ];
    expect(getBytes(fields, 1)).toEqual(Uint8Array.of(2, 3));
    expect(getString(fields, 1)).toBe("\u0002\u0003");
    expect(getVarint(fields, 1)).toBe(0n);
    expect(getBool(fields, 1)).toBe(false);
    expect(getBool(fields, 2)).toBe(true);
    expect(getVarint(fields, 2)).toBe(9n);
    expect(getFloat(fields, 7)).toBe(-1);
    expect(getBytes(fields, 3)).toBeUndefined();
    expect(getString(fields, 3)).toBeUndefined();
    expect(getVarint(fields, 3)).toBeUndefined();
    expect(getFloat(fields, 3)).toBeUndefined();
    expect(getBool(fields, 3)).toBeUndefined();
    expect(getMessages(fields, 4).map((message) => getVarint(message, 1))).toEqual([1n, 2n]);
    expect(getBool([{ field: 1, wire: 0, number: 2n }], 1)).toBe(true);
    expect(getString(decodeProto(encodeProto([
      { field: 2, wire: 2, bytes: new TextEncoder().encode("café") },
    ])), 2)).toBe("café");
  });

  it("replaces the first field of that number or appends", () => {
    const unknown: ProtoField = { field: 99, wire: 1, number: 5n };
    const fields: ProtoField[] = [
      { field: 1, wire: 2, bytes: Uint8Array.of(1) },
      unknown,
      { field: 1, wire: 2, bytes: Uint8Array.of(2) },
      { field: 2, wire: 0, number: 1n },
      { field: 2, wire: 0, number: 2n },
    ];
    const bytesReplaced = replaceBytes(fields, 1, Uint8Array.of(9));
    expect(bytesReplaced.map((item) => item.field)).toEqual([1, 99, 1, 2, 2]);
    expect(bytesReplaced[0]).toEqual({ field: 1, wire: 2, bytes: Uint8Array.of(9) });
    expect(bytesReplaced[1]).toBe(unknown);
    expect(bytesReplaced[2]).toEqual({ field: 1, wire: 2, bytes: Uint8Array.of(2) });
    expect(fields[0]).toEqual({ field: 1, wire: 2, bytes: Uint8Array.of(1) });

    const varintReplaced = replaceVarint(fields, 2, 7n);
    expect(varintReplaced[3]).toEqual({ field: 2, wire: 0, number: 7n });
    expect(varintReplaced[4]).toEqual({ field: 2, wire: 0, number: 2n });
    expect(varintReplaced[1]).toEqual(unknown);

    const appendedBytes = replaceBytes([unknown], 3, Uint8Array.of(8));
    expect(appendedBytes).toEqual([unknown, { field: 3, wire: 2, bytes: Uint8Array.of(8) }]);
    const appendedVarint = replaceVarint([unknown], 4, 4n);
    expect(appendedVarint).toEqual([unknown, { field: 4, wire: 0, number: 4n }]);

    const retyped = replaceBytes([{ field: 3, wire: 0, number: 1n }], 3, Uint8Array.of(4));
    expect(retyped).toEqual([{ field: 3, wire: 2, bytes: Uint8Array.of(4) }]);
    const retypedVarint = replaceVarint([{ field: 3, wire: 2, bytes: Uint8Array.of(4) }], 3, 11n);
    expect(retypedVarint).toEqual([{ field: 3, wire: 0, number: 11n }]);
  });

  it("copies length-delimited bytes out of the source buffer", () => {
    const buf = Uint8Array.of(0x0a, 0x01, 0x7f);
    const decoded = decodeProto(buf);
    buf[2] = 0;
    expect(decoded[0]?.bytes?.[0]).toBe(0x7f);
  });

  it("rejects truncated buffers, overlong varints, and unknown wire types", () => {
    expect(decodeProto(new Uint8Array())).toEqual([]);
    expect(encodeProto([])).toEqual(new Uint8Array());
    expect(() => decodeProto(Uint8Array.of(0x08))).toThrow(/truncated varint/);
    expect(() => decodeProto(Uint8Array.of(0x0d, 0x00, 0x00))).toThrow(/truncated fixed32/);
    expect(() => decodeProto(Uint8Array.of(0x09, 0x01))).toThrow(/truncated fixed64/);
    expect(() => decodeProto(Uint8Array.of(0x0a, 0x05, 0x01))).toThrow(/truncated length-delimited/);
    expect(() => decodeProto(Uint8Array.of(0x0b))).toThrow(/unsupported wire type 3/);
    expect(() => decodeProto(Uint8Array.of(0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01))).toThrow(
      /longer than 10 bytes/,
    );
    expect(() => encodeProto([{ field: 1, wire: 0 }])).toThrow(/missing number/);
    expect(() => encodeProto([{ field: 1, wire: 2 }])).toThrow(/missing bytes/);
    expect(() => encodeProto([{ field: 1, wire: 0, number: -1n }])).toThrow(/negative/);
    expect(() => replaceVarint([], 1, -1n)).toThrow(/negative/);
    expect(decodeProto(Uint8Array.of(0x0a, 0x00))).toEqual([{ field: 1, wire: 2, bytes: new Uint8Array() }]);
    expect(getMessages([{ field: 1, wire: 2, bytes: new Uint8Array() }], 1)).toEqual([[]]);
  });
});
