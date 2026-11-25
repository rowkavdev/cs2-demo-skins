import { describe, expect, it } from "vitest";
import { BitWriter } from "../src/bits/bit-writer.js";
import type { BitSlice, FieldSpec, Serializer, SerializerField } from "../src/contract.js";
import { readEntityData, rewritePacketEntitiesPayload, writeEntityData } from "../src/entity/delta.js";
import type { EditableField, EditableRecord, PacketContext } from "../src/entity/delta.js";
import { classIdBits, parseClassInfo, parseFlattenedSerializers } from "../src/entity/serializer.js";
import { writeFieldValue } from "../src/entity/values.js";
import { decodeProto, encodeProto, getBytes } from "../src/proto/codec.js";

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function spec(name: string, index: number): SerializerField {
  return {
    index,
    name,
    typeName: "int32",
    encoder: null,
    bitCount: null,
    low: null,
    high: null,
    encodeFlags: null,
    signedEnum: false,
    serializerName: null,
  };
}

function valueBits(field: FieldSpec, value: number): BitSlice {
  const writer = new BitWriter();
  writeFieldValue(writer, field, { kind: "int", value });
  return { bytes: writer.toUint8Array(), bitLength: writer.bitLength };
}

function field(partial: SerializerField, path: number[], value: number): EditableField {
  return {
    path,
    namePath: [partial.name],
    spec: partial,
    value: { kind: "int", value },
    rawBits: valueBits(partial, value),
  };
}

function flattenedFixture(): Uint8Array {
  const definition = encodeProto([
    { field: 1, wire: 0, number: 0n },
    { field: 2, wire: 0, number: 1n },
  ]);
  const paint = encodeProto([
    { field: 1, wire: 0, number: 0n },
    { field: 2, wire: 0, number: 2n },
  ]);
  const serializer = encodeProto([
    { field: 1, wire: 0, number: 3n },
    { field: 3, wire: 0, number: 0n },
    { field: 3, wire: 0, number: 1n },
  ]);
  return encodeProto([
    { field: 1, wire: 2, bytes: serializer },
    { field: 2, wire: 2, bytes: text("int32") },
    { field: 2, wire: 2, bytes: text("m_iItemDefinitionIndex") },
    { field: 2, wire: 2, bytes: text("m_nFallbackPaintKit") },
    { field: 2, wire: 2, bytes: text("Weapon") },
    { field: 3, wire: 2, bytes: definition },
    { field: 3, wire: 2, bytes: paint },
  ]);
}

function context(serializers: Map<string, Serializer>): PacketContext {
  const classes = [{ classId: 4, networkName: "Weapon", tableName: "Weapon" }];
  return { classBits: classIdBits(classes), classes, serializers, classByIndex: new Map() };
}

describe("serializers", () => {
  it("parses a flattened serializer and class info", () => {
    const serializers = parseFlattenedSerializers(flattenedFixture());
    const weapon = serializers.get("Weapon");
    expect(weapon?.fields.map((field) => field.name)).toEqual([
      "m_iItemDefinitionIndex",
      "m_nFallbackPaintKit",
    ]);
    const classes = parseClassInfo(
      encodeProto([
        {
          field: 1,
          wire: 2,
          bytes: encodeProto([
            { field: 1, wire: 0, number: 4n },
            { field: 2, wire: 2, bytes: text("Weapon") },
            { field: 3, wire: 2, bytes: text("Weapon") },
          ]),
        },
      ]),
    );
    expect(classes).toEqual([{ classId: 4, networkName: "Weapon", tableName: "Weapon" }]);
    expect(classIdBits(classes)).toBe(3);
  });
});

describe("entity deltas", () => {
  it("round-trips a weapon create and can replace only the paint", () => {
    const serializers = parseFlattenedSerializers(flattenedFixture());
    const weapon = serializers.get("Weapon");
    if (!weapon) throw new Error("missing weapon serializer");
    const definition = weapon.fields[0];
    const paint = weapon.fields[1];
    if (!definition || !paint) throw new Error("missing fields");
    const ctx = context(serializers);
    const created: EditableRecord = {
      kind: "create",
      index: 1,
      classId: 4,
      serial: 9,
      extra: 0,
      fields: [field(definition, [0], 7), field(paint, [1], 282)],
    };
    const bytes = writeEntityData([created], ctx.classBits, 0);
    const read = readEntityData(bytes, 1, ctx.classBits, 0, ctx);
    expect(read[0]?.kind).toBe("create");
    if (read[0]?.kind !== "create") return;
    expect(read[0].classId).toBe(4);
    expect(read[0].fields.map((item) => (item.value.kind === "int" ? item.value.value : null))).toEqual([7, 282]);

    const painted = read[0].fields[1] as EditableField;
    painted.valueOverride = { kind: "int", value: 309 };
    const rewritten = writeEntityData(read, ctx.classBits, 0);
    const again = readEntityData(rewritten, 1, ctx.classBits, 0, context(serializers));
    if (again[0]?.kind !== "create") throw new Error("expected create");
    const values = again[0].fields.map((item) => (item.value.kind === "int" ? item.value.value : null));
    expect(values).toEqual([7, 309]);
  });

  it("rewrites paint inside a packet-entities payload", () => {
    const serializers = parseFlattenedSerializers(flattenedFixture());
    const weapon = serializers.get("Weapon");
    if (!weapon?.fields[0] || !weapon.fields[1]) throw new Error("missing weapon");
    const ctx = context(serializers);
    const created: EditableRecord = {
      kind: "create",
      index: 2,
      classId: 4,
      serial: 1,
      extra: 0,
      fields: [field(weapon.fields[0], [0], 7), field(weapon.fields[1], [1], 282)],
    };
    const entityData = writeEntityData([created], ctx.classBits, 0);
    const payload = encodeProto([
      { field: 2, wire: 0, number: 1n },
      { field: 7, wire: 2, bytes: entityData },
    ]);
    const edited = rewritePacketEntitiesPayload(payload, ctx, (records) => {
      const create = records[0];
      if (create?.kind === "create") {
        const paintField = create.fields[1] as EditableField;
        paintField.valueOverride = { kind: "int", value: 309 };
      }
      return { records, warnings: [] };
    });
    const after = rewritePacketEntitiesPayload(edited.payload, context(serializers), (records) => ({
      records,
      warnings: [],
    }));
    const create = readEntityData(
      getEntityData(edited.payload),
      1,
      ctx.classBits,
      0,
      context(serializers),
    )[0];
    if (create?.kind !== "create") throw new Error("expected create");
    expect(create.fields.map((item) => (item.value.kind === "int" ? item.value.value : null))).toEqual([7, 309]);
    expect(after.warnings).toEqual([]);
  });
});

function getEntityData(payload: Uint8Array): Uint8Array {
  return getBytes(decodeProto(payload), 7) ?? new Uint8Array();
}
