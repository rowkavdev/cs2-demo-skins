import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BitWriter } from "../src/bits/bit-writer.js";
import { writeBitVarU32, writeUBitVar } from "../src/bits/ubit.js";
import { resolveKnife, resolveSticker } from "../src/catalog/index.js";
import type { BitSlice, FieldSpec, FieldValue, Serializer } from "../src/contract.js";
import { DEM_CLASS_INFO, DEM_PACKET, DEM_SEND_TABLES, SVC_PACKET_ENTITIES } from "../src/contract.js";
import { readDemo, writeDemo } from "../src/demo/frame.js";
import { assertNoIdentityChange } from "../src/edit/plan.js";
import { formatRewrite } from "../src/edit/report.js";
import { assertCosmeticWrite, assertKnifeDefinitionWrite, vanillaCosmetic } from "../src/edit/policy.js";
import { describeDemo, rewriteDemo } from "../src/edit/session.js";
import type { EditableField, EditableRecord, PacketContext } from "../src/entity/delta.js";
import { rewritePacketBody, writeEntityData } from "../src/entity/delta.js";
import { classIdBits, parseClassInfo, parseFlattenedSerializers } from "../src/entity/serializer.js";
import { floatToIntBits, intBitsToFloat, writeFieldValue } from "../src/entity/values.js";
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
  const encoded: FieldValue = typeName.includes("float")
    ? { kind: "float", value }
    : typeName.includes("uint")
      ? { kind: "uint", value }
      : { kind: "int", value };
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

function fieldMessage(typeSymbol: number, nameSymbol: number, serializerSymbol?: number): Uint8Array {
  const entries: Array<{ field: number; wire: 0; number: bigint }> = [
    { field: 1, wire: 0, number: BigInt(typeSymbol) },
    { field: 2, wire: 0, number: BigInt(nameSymbol) },
  ];
  if (serializerSymbol !== undefined) entries.push({ field: 7, wire: 0, number: BigInt(serializerSymbol) });
  return encodeProto(entries);
}

function demoWithWeapon(
  extra: Array<{ tick: number; records: EditableRecord[] }> = [],
  options?: { knife?: boolean },
): Uint8Array {
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
    "m_iEntityQuality",
    "CUtlVector<CEconItemAttribute>",
    "m_Attributes",
    "CEconItemAttribute",
    "m_iAttributeDefinitionIndex",
    "m_iRawValue32",
    "m_flInitialValue",
    "uint16",
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
    fieldMessage(0, 17),
    fieldMessage(18, 19, 20),
    fieldMessage(24, 21),
    fieldMessage(2, 22),
    fieldMessage(2, 23),
  ];
  const serializer = (nameSymbol: number, indexes: number[]) =>
    encodeProto([
      { field: 1, wire: 0, number: BigInt(nameSymbol) },
      ...indexes.map((index) => ({ field: 3, wire: 0 as const, number: BigInt(index) })),
    ]);
  const tables = encodeProto([
    { field: 1, wire: 2, bytes: serializer(14, [0, 1]) },
    { field: 1, wire: 2, bytes: serializer(15, [2, 3]) },
    { field: 1, wire: 2, bytes: serializer(16, [4, 5, 6, 7, 8, 9, 10, 11]) },
    { field: 1, wire: 2, bytes: serializer(20, [12, 13, 14]) },
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
  if (options?.knife) {
    records.push({
      kind: "create",
      index: 4,
      classId: 3,
      serial: 1,
      extra: 0,
      fields: [
        intField("m_iItemDefinitionIndex", "int32", [0], 42),
        intField("m_nFallbackPaintKit", "int32", [1], 0),
        intField("m_nFallbackSeed", "int32", [2], 0),
        intField("m_flFallbackWear", "float32", [3], 0),
        intField("m_nFallbackStatTrak", "int32", [4], -1),
        intField("m_hOwnerEntity", "uint32", [5], 2),
        intField("m_iEntityQuality", "int32", [6], 0),
      ],
    });
  }
  const entityData = writeEntityData(records, 2, 0);
  const payload = encodeProto([
    { field: 2, wire: 0, number: BigInt(records.length) },
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

  it("swaps a stock knife for a karambit and leaves the ak alone", () => {
    const result = rewriteDemo(demoWithWeapon([], { knife: true }), {
      operations: [{ op: "knife", player: "s1mple", knife: "karambit" }],
    });
    expect(result.weaponIdentityPreserved).toBe(true);
    const described = describeDemo(result.output ?? new Uint8Array());
    const ids = described.weapons.map((weapon) => weapon.weaponId);
    expect(ids).toContain(507);
    expect(ids).toContain(7);
    expect(ids).not.toContain(42);
    expect(described.weapons.find((weapon) => weapon.weaponId === 507)?.quality).toBe(3);
    expect(formatRewrite(result)).toContain("def 42 -> 507");
    expect(formatRewrite(result)).toContain("knife definition indexes changed");
  });

  it("warns when the player has no knife and does not touch the ak", () => {
    const result = rewriteDemo(demoWithWeapon(), {
      operations: [{ op: "knife", player: "s1mple", knife: "karambit" }],
    });
    expect(result.warnings.some((warning) => warning.message.includes("no knife matched"))).toBe(true);
    const described = describeDemo(result.output ?? new Uint8Array());
    expect(described.weapons.find((weapon) => weapon.weaponId === 7)?.weaponId).toBe(7);
    expect(described.weapons.some((weapon) => weapon.weaponId === 507)).toBe(false);
  });

  it("refuses to turn a gun into a knife", () => {
    expect(resolveKnife("ak")).toBeUndefined();
    expect(resolveKnife("karambit")?.id).toBe(507);
    expect(() => assertKnifeDefinitionWrite(7, 507)).toThrow(/refusing to change definition index 7 to 507/);
    expect(() => rewriteDemo(demoWithWeapon(), { operations: [{ op: "knife", player: "s1mple", knife: "ak" }] })).toThrow(/ak is not a knife/);
  });

  it("puts the stock knife back after the window", () => {
    const input = demoWithWeapon(
      [
        {
          tick: 400,
          records: [
            {
              kind: "update",
              index: 4,
              fields: [
                intField("m_iItemDefinitionIndex", "int32", [0], 42),
                intField("m_iEntityQuality", "int32", [6], 0),
              ],
            },
          ],
        },
      ],
      { knife: true },
    );
    const result = rewriteDemo(input, {
      operations: [{ op: "knife", player: "s1mple", knife: "karambit", from: "tick:128", to: "tick:128" }],
    });
    const ids = describeDemo(result.output ?? new Uint8Array()).weapons.map((weapon) => weapon.weaponId);
    expect(ids).toContain(507);
    expect(ids).toContain(42);
    expect(ids).toContain(7);
  });

  it("writes four titan holos into the default ak slots", () => {
    const result = rewriteDemo(demoWithWeapon(), {
      operations: [
        {
          op: "stickers",
          player: "s1mple",
          weapon: "ak",
          stickers: ["titan holo", "titan holo", "titan holo", "titan holo"],
        },
      ],
    });
    expect(result.output).not.toBeNull();
    const weapon = describeDemo(result.output ?? new Uint8Array()).weapons.find((item) => item.weaponId === 7);
    expect(weapon?.stickers).toEqual([76, 76, 76, 76]);
    expect(attributeValues(result.output ?? new Uint8Array(), 3).defs).toEqual([113, 117, 121, 125]);
    expect(attributeValues(result.output ?? new Uint8Array(), 3).raws).toEqual([76, 76, 76, 76]);
    expect(formatRewrite(result)).toContain("stickers 76,76,76,76");
  });

  it("clears the sticker craft after the window", () => {
    const input = demoWithWeapon([
      { tick: 400, records: [{ kind: "update", index: 3, fields: [intField("m_nFallbackPaintKit", "int32", [1], 282)] }] },
    ]);
    const result = rewriteDemo(input, {
      operations: [
        {
          op: "stickers",
          player: "s1mple",
          weapon: "ak",
          stickers: ["titan holo", "titan holo", "titan holo", "titan holo"],
          from: "tick:128",
          to: "tick:128",
        },
      ],
    });
    const ak = describeDemo(result.output ?? new Uint8Array()).weapons.filter((weapon) => weapon.weaponId === 7);
    expect(ak.some((weapon) => weapon.stickers.join(",") === "76,76,76,76")).toBe(true);
    expect(ak[ak.length - 1]?.stickers).toEqual([]);
  });

  it("zeros sticker slot bits and leaves the initial float alone", () => {
    const input = demoWithWeapon([
      {
        tick: 200,
        records: [
          {
            kind: "update",
            index: 3,
            fields: [
              intField("m_iAttributeDefinitionIndex", "uint16", [7, 0, 0], 113),
              intField("m_iRawValue32", "float32", [7, 0, 1], intBitsToFloat(76)),
              intField("m_flInitialValue", "float32", [7, 0, 2], 1.5),
            ],
          },
        ],
      },
    ]);
    const result = rewriteDemo(input, { operations: [{ op: "strip", stickers: true }] });
    expect(result.warnings.some((warning) => warning.message.includes("left its new fields unwritten"))).toBe(false);
    const packets = entityFields(result.output ?? new Uint8Array(), 3);
    const update = packets[packets.length - 1] ?? [];
    const raw = update.find((field) => leafOf(field) === "m_iRawValue32");
    const initial = update.find((field) => leafOf(field) === "m_flInitialValue");
    expect(raw?.value.kind).toBe("float");
    if (raw?.value.kind === "float") expect(floatToIntBits(raw.value.value)).toBe(0);
    expect(initial?.value).toEqual({ kind: "float", value: 1.5 });
  });

  it("exits 0 after a successful dry run", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs2skin-"));
    const demo = join(dir, "in.dem");
    try {
      writeFileSync(demo, demoWithWeapon());
      const result = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "--import", "./scripts/register-ts.mjs", "src/cli.ts", "set", demo, "--player", "s1mple", "--paint", "howl", "--dry-run"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("282 -> 309");
      expect(result.stderr).not.toContain("unknown command");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sticker bits", () => {
  it("keeps kit 76 in the float's integer bits", () => {
    expect(floatToIntBits(intBitsToFloat(76))).toBe(76);
    expect(resolveSticker("titan holo")?.id).toBe(76);
    expect(resolveSticker("titan (holo)")?.id).toBe(76);
    expect(resolveSticker("titan")).toBeUndefined();
  });

  it("rejects a sixth sticker slot before writing", () => {
    expect(() =>
      rewriteDemo(demoWithWeapon(), {
        operations: [{ op: "stickers", player: "s1mple", stickers: [1, 2, 3, 4, 5, 6] }],
      }),
    ).toThrow(/5 sticker/);
  });
});

function leafOf(field: EditableField): string {
  return field.namePath[field.namePath.length - 1] ?? "";
}

function entityFields(bytes: Uint8Array, entity: number): EditableField[][] {
  const file = readDemo(bytes);
  const serializers = new Map<string, Serializer>();
  let classes = parseClassInfo(new Uint8Array());
  for (const command of file.commands) {
    if (command.command === DEM_SEND_TABLES) {
      for (const [name, serializer] of parseFlattenedSerializers(command.body)) serializers.set(name, serializer);
    }
    if (command.command === DEM_CLASS_INFO) classes = parseClassInfo(command.body);
  }
  const ctx: PacketContext = { classBits: classIdBits(classes), classes, serializers, classByIndex: new Map() };
  const found: EditableField[][] = [];
  for (const command of file.commands) {
    if (command.command !== DEM_PACKET) continue;
    rewritePacketBody(command.body, command.command, ctx, (records) => {
      for (const record of records) {
        if (record.index === entity && (record.kind === "update" || record.kind === "create")) {
          found.push(record.fields as EditableField[]);
        }
      }
      return { records, warnings: [] };
    });
  }
  return found;
}

function attributeValues(bytes: Uint8Array, entity: number): { defs: number[]; raws: number[] } {
  const defs: number[] = [];
  const raws: number[] = [];
  for (const fields of entityFields(bytes, entity)) {
    const byIndex = new Map<string, { def?: number; raw?: number }>();
    for (const field of fields) {
      const names = field.namePath;
      const at = names.lastIndexOf("m_Attributes");
      if (at < 0 || at + 1 >= names.length) continue;
      const key = names[at + 1] ?? "";
      const slot = byIndex.get(key) ?? {};
      const leaf = leafOf(field);
      if (leaf === "m_iAttributeDefinitionIndex" && (field.value.kind === "int" || field.value.kind === "uint")) {
        slot.def = field.value.value;
      }
      if (leaf === "m_iRawValue32" && field.value.kind === "float") slot.raw = floatToIntBits(field.value.value);
      byIndex.set(key, slot);
    }
    for (const slot of byIndex.values()) {
      if (slot.def !== undefined) defs.push(slot.def);
      if (slot.raw !== undefined) raws.push(slot.raw);
    }
  }
  return { defs, raws };
}
