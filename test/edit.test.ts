import { describe, expect, it } from "vitest";
import { BitWriter } from "../src/bits/bit-writer.js";
import { writeBitVarU32, writeUBitVar } from "../src/bits/ubit.js";
import type { BitSlice, FieldSpec, FieldValue } from "../src/contract.js";
import { DEM_CLASS_INFO, DEM_PACKET, DEM_SEND_TABLES, SVC_PACKET_ENTITIES } from "../src/contract.js";
import { writeDemo } from "../src/demo/frame.js";
import { assertNoIdentityChange } from "../src/edit/plan.js";
import { assertCosmeticWrite, vanillaCosmetic } from "../src/edit/policy.js";
import { describeDemo, rewriteDemo } from "../src/edit/session.js";
import type { EditableField, EditableRecord } from "../src/entity/delta.js";
import { writeEntityData } from "../src/entity/delta.js";
import { writeFieldValue } from "../src/entity/values.js";
import { encodeProto } from "../src/proto/codec.js";

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bits(spec: FieldSpec, value: FieldValue): BitSlice {
  const writer = new BitWriter();
  writeFieldValue(writer, spec, value);
  return { bytes: writer.toUint8Array(), bitLength: writer.bitLength };
}

function intField(name: string, typeName: string, path: number[], value: number): EditableField {
  const spec: FieldSpec = {
    name,
    typeName,
    encoder: null,
    bitCount: null,
    low: null,
    high: null,
    encodeFlags: null,
    signedEnum: false,
  };
  const encoded: FieldValue =
    typeName === "float32" ? { kind: "float", value } : typeName === "uint32" ? { kind: "uint", value } : { kind: "int", value };
  return { path, namePath: [name], spec, value: encoded, rawBits: bits(spec, encoded) };
}

function stringField(name: string, path: number[], value: string): EditableField {
  const spec: FieldSpec = {
    name,
    typeName: "CUtlString",
    encoder: null,
    bitCount: null,
    low: null,
    high: null,
    encodeFlags: null,
    signedEnum: false,
  };
  const encoded: FieldValue = { kind: "string", value };
  return { path, namePath: [name], spec, value: encoded, rawBits: bits(spec, encoded) };
}

function fieldMessage(typeSymbol: number, nameSymbol: number): Uint8Array {
  return encodeProto([
    { field: 1, wire: 0, number: BigInt(typeSymbol) },
    { field: 2, wire: 0, number: BigInt(nameSymbol) },
  ]);
}

function demoWithWeapon(extra: Array<{ tick: number; records: EditableRecord[] }> = []): Uint8Array {
  const symbols = [
    "int32",
    "uint32",
    "float32",
    "CUtlString",
    "m_sSanitizedPlayerName",
    "m_hPlayerPawn",
    "m_hController",
    "m_hActiveWeapon",
    "m_iItemDefinitionIndex",
    "m_nFallbackPaintKit",
    "m_nFallbackSeed",
    "m_flFallbackWear",
    "m_nFallbackStatTrak",
    "m_hOwnerEntity",
    "CCSPlayerController",
    "CCSPlayerPawn",
    "Weapon",
  ];
  const globalFields = [
    fieldMessage(3, 4),
    fieldMessage(1, 5),
    fieldMessage(1, 6),
    fieldMessage(1, 7),
    fieldMessage(0, 8),
    fieldMessage(0, 9),
    fieldMessage(0, 10),
    fieldMessage(2, 11),
    fieldMessage(0, 12),
    fieldMessage(1, 13),
  ];
  const serializer = (nameSymbol: number, indexes: number[]) =>
    encodeProto([
      { field: 1, wire: 0, number: BigInt(nameSymbol) },
      ...indexes.map((index) => ({ field: 3, wire: 0 as const, number: BigInt(index) })),
    ]);
  const tables = encodeProto([
    { field: 1, wire: 2, bytes: serializer(14, [0, 1]) },
    { field: 1, wire: 2, bytes: serializer(15, [2, 3]) },
    { field: 1, wire: 2, bytes: serializer(16, [4, 5, 6, 7, 8, 9]) },
    ...symbols.map((symbol) => ({ field: 2, wire: 2 as const, bytes: text(symbol) })),
    ...globalFields.map((bytes) => ({ field: 3, wire: 2 as const, bytes })),
  ]);
  const classMessage = (classId: number, name: string) =>
    encodeProto([
      { field: 1, wire: 0, number: BigInt(classId) },
      { field: 2, wire: 2, bytes: text(name) },
      { field: 3, wire: 2, bytes: text(name) },
    ]);
  const classes = encodeProto([
    { field: 1, wire: 2, bytes: classMessage(1, "CCSPlayerController") },
    { field: 1, wire: 2, bytes: classMessage(2, "CCSPlayerPawn") },
    { field: 1, wire: 2, bytes: classMessage(3, "Weapon") },
  ]);
  const records: EditableRecord[] = [
    {
      kind: "create",
      index: 1,
      classId: 1,
      serial: 1,
      extra: 0,
      fields: [stringField("m_sSanitizedPlayerName", [0], "s1mple"), intField("m_hPlayerPawn", "uint32", [1], 2)],
    },
    {
      kind: "create",
      index: 2,
      classId: 2,
      serial: 1,
      extra: 0,
      fields: [intField("m_hController", "uint32", [0], 1), intField("m_hActiveWeapon", "uint32", [1], 3)],
    },
    {
      kind: "create",
      index: 3,
      classId: 3,
      serial: 1,
      extra: 0,
      fields: [
        intField("m_iItemDefinitionIndex", "int32", [0], 7),
        intField("m_nFallbackPaintKit", "int32", [1], 282),
        intField("m_nFallbackSeed", "int32", [2], 4),
        intField("m_flFallbackWear", "float32", [3], 0.07),
        intField("m_nFallbackStatTrak", "int32", [4], -1),
        intField("m_hOwnerEntity", "uint32", [5], 2),
      ],
    },
  ];
  const entityData = writeEntityData(records, 2, 0);
  const payload = encodeProto([
    { field: 2, wire: 0, number: 3n },
    { field: 7, wire: 2, bytes: entityData },
  ]);
  const net = new BitWriter();
  writeUBitVar(net, SVC_PACKET_ENTITIES);
  writeBitVarU32(net, payload.length);
  net.writeBytes(payload);
  const packet = encodeProto([{ field: 3, wire: 2, bytes: net.toUint8Array() }]);
  const commands = [
    { command: DEM_SEND_TABLES, compressed: false, tick: 100, body: tables },
    { command: DEM_CLASS_INFO, compressed: false, tick: 100, body: classes },
    { command: DEM_PACKET, compressed: false, tick: 128, body: packet },
  ];
  for (const packet of extra) {
    const data = writeEntityData(packet.records, 2, 0);
    const payload = encodeProto([
      { field: 2, wire: 0, number: BigInt(packet.records.length) },
      { field: 7, wire: 2, bytes: data },
    ]);
    const bits = new BitWriter();
    writeUBitVar(bits, SVC_PACKET_ENTITIES);
    writeBitVarU32(bits, payload.length);
    bits.writeBytes(payload);
    commands.push({
      command: DEM_PACKET,
      compressed: false,
      tick: packet.tick,
      body: encodeProto([{ field: 3, wire: 2, bytes: bits.toUint8Array() }]),
    });
  }
  return writeDemo({ commands });
}

describe("cosmetic policy", () => {
  it("refuses to write a weapon definition index", () => {
    expect(() => assertCosmeticWrite("m_iItemDefinitionIndex")).toThrow(/m_iItemDefinitionIndex/);
    expect(() => assertNoIdentityChange("m_iItemIDHigh")).toThrow(/m_iItemIDHigh/);
  });

  it("uses vanilla paint, seed, wear, and StatTrak", () => {
    expect(vanillaCosmetic()).toEqual({ paint: 0, seed: 0, wear: 0, stattrak: -1 });
  });
});

describe("rewriteDemo", () => {
  it("changes paint and leaves the definition index at 7", () => {
    const input = demoWithWeapon();
    const result = rewriteDemo(input, { operations: [{ op: "set", player: "s1mple", paint: 309 }] });
    expect(result.weaponIdentityPreserved).toBe(true);
    expect(result.output).not.toBeNull();
    const described = describeDemo(result.output ?? new Uint8Array());
    const weapon = described.weapons.find((item) => item.weaponId === 7);
    expect(weapon?.paint).toBe(309);
    expect(weapon?.weaponId).toBe(7);
  });

  it("strips a skin back to vanilla", () => {
    const input = demoWithWeapon();
    const painted = rewriteDemo(input, { operations: [{ op: "set", player: "s1mple", paint: 309 }] });
    const stripped = rewriteDemo(painted.output ?? new Uint8Array(), { operations: [{ op: "strip" }] });
    const described = describeDemo(stripped.output ?? new Uint8Array());
    const weapon = described.weapons.find((item) => item.weaponId === 7);
    expect(weapon).toMatchObject({ weaponId: 7, paint: 0, seed: 0, wear: 0, stattrak: -1 });
  });

  it("puts the original paint back after the time window", () => {
    const paint = intField("m_nFallbackPaintKit", "int32", [1], 282);
    const input = demoWithWeapon([
      { tick: 200, records: [{ kind: "update", index: 3, fields: [paint] }] },
      { tick: 400, records: [{ kind: "update", index: 3, fields: [intField("m_nFallbackPaintKit", "int32", [1], 282)] }] },
    ]);
    const result = rewriteDemo(input, {
      operations: [{ op: "set", player: "s1mple", paint: 309, from: "tick:128", to: "tick:200" }],
    });
    const paints = describeDemo(result.output ?? new Uint8Array()).weapons.map((weapon) => weapon.paint);
    expect(paints).toContain(309);
    expect(paints[paints.length - 1]).toBe(282);
    expect(result.weaponIdentityPreserved).toBe(true);
  });

  it("rejects a missing player before it writes", () => {
    expect(() => rewriteDemo(demoWithWeapon(), { operations: [{ op: "set", player: "nobody", paint: 1 }] })).toThrow(/not found/);
  });
});
