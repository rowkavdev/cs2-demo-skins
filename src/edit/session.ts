import { paintName, weaponName } from "../catalog/index.js";
import { BitReader } from "../bits/bit-reader.js";
import { readBitVarU32, readUBitVar } from "../bits/ubit.js";
import type {
  DemoCommand,
  DemoFile,
  EditScript,
  FieldValue,
  InspectWeapon,
  RewriteResult,
  RewriteWarning,
  Serializer,
  SkinChange,
} from "../contract.js";
import {
  DEM_CLASS_INFO,
  DEM_FILE_HEADER,
  DEM_PACKET,
  DEM_SEND_TABLES,
  DEM_SIGNON_PACKET,
  DEM_STRING_TABLES,
  DEM_FULL_PACKET,
  SVC_SERVER_INFO,
  SERVER_INFO_TICK_INTERVAL_FIELD,
} from "../contract.js";
import { readDemo, writeDemo } from "../demo/frame.js";
import type { EditableField, EditableRecord, PacketContext } from "../entity/delta.js";
import { rewritePacketBody } from "../entity/delta.js";
import { classIdBits, parseClassInfo, parseFlattenedSerializers } from "../entity/serializer.js";
import { decodeProto, getBytes, getFloat, getMessages, getString } from "../proto/codec.js";
import { applyCosmeticPatch, stripPatch } from "./apply.js";
import type { CosmeticPatch } from "./apply.js";
import { inWindow, planOperations } from "./plan.js";
import type { KnownPlayer, PlannedOp } from "./plan.js";
import { COSMETIC_NAMES, vanillaCosmetic } from "./policy.js";

const HANDLE_MASK = 0x7fff;
const NO_ENTITY = 0x7fff;

type Live = {
  className: string;
  values: Map<string, FieldValue>;
  weapons: number[];
};

type Clock = { startTick: number; tickInterval: number; endTick: number; mapName: string | null };

type Restore = { paint: number; seed: number; wear: number; stattrak: number; done: boolean };

export function rewriteDemo(
  input: Uint8Array,
  script: EditScript,
  options?: { dryRun?: boolean },
): RewriteResult {
  const dryRun = options?.dryRun === true;
  const file = readDemo(input);
  const clock = readClock(file);
  const ctx = buildContext(file);
  const discovered = collectPlayers(file, ctx);
  const plans = planOperations(script.operations, discovered, clock);
  const baselines = script.operations.some((operation) => operation.op === "strip" && !operation.from && !operation.to);
  ctx.baselines = baselines;
  ctx.classByIndex = new Map();

  const world = new Map<number, Live>();
  const changes: SkinChange[] = [];
  const warnings: RewriteWarning[] = [];
  const restores = new Map<string, Restore>();
  const inputDefs = new Map<number, number[]>();

  const commands = file.commands.map((command) => {
    if (!shouldTouch(command.command, baselines)) return command;
    const edited = rewritePacketBody(command.body, command.command, ctx, (records) => {
      const messages: string[] = [];
      const next = records.map((record) =>
        editRecord(record, command.tick, ctx, world, plans, restores, changes, messages, inputDefs),
      );
      return { records: next, warnings: messages };
    });
    for (const message of edited.warnings) warnings.push({ tick: command.tick, entity: -1, message });
    return { ...command, body: edited.body };
  });

  const players = playersFrom(world, discovered);
  if (dryRun) {
    return {
      output: null,
      dryRun: true,
      changes,
      warnings,
      players,
      mapName: clock.mapName,
      tickInterval: clock.tickInterval,
      startTick: clock.startTick,
      endTick: clock.endTick,
      weaponIdentityPreserved: true,
    };
  }

  const output = writeDemo({ commands });
  const outputDefs = definitionTimeline(output);
  if (!sameTimeline(inputDefs, outputDefs)) {
    throw new Error("refusing to return bytes: a weapon definition index changed");
  }
  return {
    output,
    dryRun: false,
    changes,
    warnings,
    players,
    mapName: clock.mapName,
    tickInterval: clock.tickInterval,
    startTick: clock.startTick,
    endTick: clock.endTick,
    weaponIdentityPreserved: true,
  };
}

export function describeDemo(input: Uint8Array): {
  mapName: string | null;
  tickInterval: number;
  startTick: number;
  endTick: number;
  players: KnownPlayer[];
  weapons: InspectWeapon[];
} {
  const file = readDemo(input);
  const clock = readClock(file);
  const ctx = buildContext(file);
  const world = new Map<number, Live>();
  const weapons: InspectWeapon[] = [];
  const seen = new Set<string>();
  for (const command of file.commands) {
    if (command.command !== DEM_PACKET && command.command !== DEM_SIGNON_PACKET && command.command !== DEM_FULL_PACKET) {
      continue;
    }
    rewritePacketBody(command.body, command.command, ctx, (records) => {
      for (const record of records) {
        remember(world, record, ctx);
        const sample = sampleWeapon(world, record, command.tick);
        if (!sample) continue;
        const key = `${sample.entity}:${sample.weaponId}:${sample.paint}:${sample.owner}`;
        if (seen.has(key) || weapons.length >= 500) continue;
        seen.add(key);
        weapons.push(sample);
      }
      return { records, warnings: [] };
    });
  }
  return {
    mapName: clock.mapName,
    tickInterval: clock.tickInterval,
    startTick: clock.startTick,
    endTick: clock.endTick,
    players: playersFrom(world, []),
    weapons,
  };
}

function editRecord(
  record: EditableRecord,
  tick: number,
  ctx: PacketContext,
  world: Map<number, Live>,
  plans: PlannedOp[],
  restores: Map<string, Restore>,
  changes: SkinChange[],
  warnings: string[],
  defs: Map<number, number[]>,
): EditableRecord {
  const previous = record.kind === "update" || record.kind === "create" ? definitionOf(record) : null;
  remember(world, record, ctx);
  if (record.kind === "delete") {
    world.delete(record.index);
    return record;
  }
  if (record.kind !== "update" && record.kind !== "create") return record;
  if (previous !== null) pushDef(defs, record.index, previous);
  const live = world.get(record.index);
  const serializer = live ? serializerByName(ctx, live.className) : undefined;
  if (!live || !serializer || numberValue(live.values.get("m_iItemDefinitionIndex")) === null) return record;
  const baseline = record.index < 0;
  const owner = ownerOf(world, record.index);
  const weaponId = numberValue(live.values.get("m_iItemDefinitionIndex"));
  if (weaponId === null) return record;

  for (const plan of plans) {
    if (baseline && plan.kind !== "strip") continue;
    const key = `${plan.kind}:${plan.player?.steamId ?? plan.player?.name ?? "*"}:${record.index}`;
    if (plan.range.toTick !== null && tick > plan.range.toTick) {
      const saved = restores.get(key);
      if (saved && !saved.done) {
        const patched = applyCosmeticPatch(record, serializer, ctx.serializers, saved, warnings);
        saved.done = true;
        if (patched) noteChange(changes, tick, record.index, owner, weaponId, patched.before, patched.after);
      }
      continue;
    }
    if (baseline ? plan.range.fromTick !== null || plan.range.toTick !== null : !inWindow(tick, plan.range)) continue;
    if (plan.kind === "set") {
      if (!samePlayer(owner, plan.player)) continue;
      if (plan.weaponId !== null && plan.weaponId !== weaponId) continue;
    }
    const patch: CosmeticPatch = plan.kind === "strip"
      ? { ...stripPatch(), stickers: plan.stickers }
      : { paint: plan.paint ?? undefined, seed: plan.seed, wear: plan.wear, stattrak: plan.stattrak };
    if (!restores.has(key)) {
      const current = readLiveCosmetics(live);
      restores.set(key, { ...current, done: false });
    }
    const patched = applyCosmeticPatch(record, serializer, ctx.serializers, patch, warnings);
    if (patched) {
      storeCosmetics(live, patched.after);
      noteChange(changes, tick, record.index, owner, weaponId, patched.before, patched.after);
    }
  }
  return record;
}

function collectPlayers(file: DemoFile, ctx: PacketContext): KnownPlayer[] {
  const saved = ctx.classByIndex;
  ctx.classByIndex = new Map();
  const world = new Map<number, Live>();
  for (const command of file.commands) {
    if (command.command !== DEM_PACKET && command.command !== DEM_SIGNON_PACKET && command.command !== DEM_FULL_PACKET) continue;
    rewritePacketBody(command.body, command.command, ctx, (records) => {
      for (const record of records) {
        remember(world, record, ctx);
        if (record.kind === "delete") world.delete(record.index);
      }
      return { records, warnings: [] };
    });
  }
  const players = playersFrom(world, []);
  ctx.classByIndex = saved;
  return players;
}

function remember(world: Map<number, Live>, record: EditableRecord, ctx: PacketContext): void {
  if (record.kind === "leave") return;
  if (record.kind === "delete") return;
  const className = record.kind === "create" ? classNameOf(ctx, record.classId) : (world.get(record.index)?.className ?? "");
  const live: Live = world.get(record.index) ?? { className, values: new Map(), weapons: [] };
  if (className) live.className = className;
  for (const field of record.fields as EditableField[]) {
    const leaf = field.namePath[field.namePath.length - 1] ?? "";
    const value = field.valueOverride ?? field.value;
    live.values.set(leaf, value);
    live.values.set(field.namePath.join("."), value);
    if (leaf.includes("m_hMyWeapons") || field.namePath.some((part) => part.includes("m_hMyWeapons"))) {
      const handle = handleIndex(value);
      if (handle !== null && !live.weapons.includes(handle)) live.weapons.push(handle);
    }
  }
  world.set(record.index, live);
}

function sampleWeapon(world: Map<number, Live>, record: EditableRecord, tick: number): InspectWeapon | null {
  if (record.kind !== "update" && record.kind !== "create") return null;
  const live = world.get(record.index);
  const weaponId = live ? numberValue(live.values.get("m_iItemDefinitionIndex")) : null;
  if (!live || weaponId === null) return null;
  const owner = ownerOf(world, record.index);
  const cosmetics = readLiveCosmetics(live);
  return {
    tick,
    entity: record.index,
    owner: owner?.name ?? null,
    weaponId,
    weaponName: weaponName(weaponId) ?? String(weaponId),
    paint: cosmetics.paint,
    paintName: paintName(cosmetics.paint),
    seed: cosmetics.seed,
    wear: cosmetics.wear,
    stattrak: cosmetics.stattrak,
  };
}

function ownerOf(world: Map<number, Live>, weaponIndex: number): KnownPlayer | null {
  const weapon = world.get(weaponIndex);
  if (!weapon) return null;
  let pawnIndex = handleIndex(weapon.values.get("m_hOwnerEntity"));
  if (pawnIndex === null) {
    for (const [index, live] of world) {
      if (live.weapons.includes(weaponIndex) || handleIndex(live.values.get("m_hActiveWeapon")) === weaponIndex) {
        pawnIndex = index;
        break;
      }
    }
  }
  if (pawnIndex === null) return null;
  const pawn = world.get(pawnIndex);
  let controllerIndex = pawn ? handleIndex(pawn.values.get("m_hController")) : null;
  if (controllerIndex === null) {
    for (const [index, live] of world) {
      if (handleIndex(live.values.get("m_hPlayerPawn")) === pawnIndex) {
        controllerIndex = index;
        break;
      }
    }
  }
  if (controllerIndex === null) return null;
  return playerFrom(world.get(controllerIndex));
}

function playerFrom(live: Live | undefined): KnownPlayer | null {
  if (!live) return null;
  const name = stringValue(live.values.get("m_sSanitizedPlayerName")) || stringValue(live.values.get("m_iszPlayerName"));
  if (!name) return null;
  return {
    name,
    steamId: steamValue(live.values.get("m_steamID")),
    team: numberValue(live.values.get("m_iTeamNum")),
  };
}

function playersFrom(world: Map<number, Live>, extra: KnownPlayer[]): KnownPlayer[] {
  const found = new Map<string, KnownPlayer>();
  for (const live of world.values()) {
    if (!live.className.includes("PlayerController") && !live.values.has("m_sSanitizedPlayerName") && !live.values.has("m_iszPlayerName")) {
      continue;
    }
    const player = playerFrom(live);
    if (!player) continue;
    found.set(player.steamId || player.name, player);
  }
  for (const player of extra) found.set(player.steamId || player.name, player);
  return [...found.values()];
}

function samePlayer(owner: KnownPlayer | null, wanted: KnownPlayer | null): boolean {
  if (!owner || !wanted) return false;
  if (wanted.steamId && owner.steamId === wanted.steamId) return true;
  return owner.name.toLowerCase() === wanted.name.toLowerCase();
}

function readLiveCosmetics(live: Live): { paint: number; seed: number; wear: number; stattrak: number } {
  const vanilla = vanillaCosmetic();
  return {
    paint: numberValue(live.values.get(COSMETIC_NAMES.paint)) ?? vanilla.paint,
    seed: numberValue(live.values.get(COSMETIC_NAMES.seed)) ?? vanilla.seed,
    wear: numberValue(live.values.get(COSMETIC_NAMES.wear)) ?? vanilla.wear,
    stattrak: numberValue(live.values.get(COSMETIC_NAMES.stattrak)) ?? vanilla.stattrak,
  };
}

function storeCosmetics(live: Live, values: { paint: number; seed: number; wear: number; stattrak: number }): void {
  live.values.set(COSMETIC_NAMES.paint, { kind: "int", value: values.paint });
  live.values.set(COSMETIC_NAMES.seed, { kind: "int", value: values.seed });
  live.values.set(COSMETIC_NAMES.wear, { kind: "float", value: values.wear });
  live.values.set(COSMETIC_NAMES.stattrak, { kind: "int", value: values.stattrak });
}

function noteChange(
  changes: SkinChange[],
  tick: number,
  entity: number,
  owner: KnownPlayer | null,
  weaponId: number,
  before: SkinChange["before"],
  after: SkinChange["after"],
): void {
  if (before.paint === after.paint && before.seed === after.seed && before.wear === after.wear && before.stattrak === after.stattrak) return;
  changes.push({
    tick,
    entity,
    player: owner?.name ?? "",
    weaponId,
    weaponName: weaponName(weaponId) ?? String(weaponId),
    before,
    after,
  });
}

function definitionTimeline(bytes: Uint8Array): Map<number, number[]> {
  const file = readDemo(bytes);
  const ctx = buildContext(file);
  const defs = new Map<number, number[]>();
  const world = new Map<number, Live>();
  for (const command of file.commands) {
    if (command.command !== DEM_PACKET && command.command !== DEM_SIGNON_PACKET && command.command !== DEM_FULL_PACKET) continue;
    rewritePacketBody(command.body, command.command, ctx, (records) => {
      for (const record of records) {
        const def = definitionOf(record);
        if (def !== null && (record.kind === "update" || record.kind === "create")) pushDef(defs, record.index, def);
        remember(world, record, ctx);
      }
      return { records, warnings: [] };
    });
  }
  return defs;
}

function definitionOf(record: EditableRecord): number | null {
  if (record.kind !== "update" && record.kind !== "create") return null;
  const field = (record.fields as EditableField[]).find((item) => (item.namePath[item.namePath.length - 1] ?? "") === "m_iItemDefinitionIndex");
  if (!field) return null;
  return numberValue(field.value);
}

function pushDef(defs: Map<number, number[]>, entity: number, value: number): void {
  const list = defs.get(entity) ?? [];
  list.push(value);
  defs.set(entity, list);
}

function sameTimeline(left: Map<number, number[]>, right: Map<number, number[]>): boolean {
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) {
    const a = left.get(key) ?? [];
    const b = right.get(key) ?? [];
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  }
  return true;
}

function buildContext(file: DemoFile): PacketContext {
  const serializers = new Map<string, Serializer>();
  let classes = parseClassInfo(new Uint8Array());
  for (const command of file.commands) {
    if (command.command === DEM_SEND_TABLES) {
      for (const [name, serializer] of parseFlattenedSerializers(command.body)) serializers.set(name, serializer);
    }
    if (command.command === DEM_CLASS_INFO) classes = parseClassInfo(command.body);
  }
  return { classBits: classIdBits(classes), classes, serializers, classByIndex: new Map() };
}

function serializerByName(ctx: PacketContext, className: string): Serializer | undefined {
  return ctx.serializers.get(className) ?? ctx.classes
    .filter((info) => info.networkName === className || info.tableName === className)
    .map((info) => ctx.serializers.get(info.networkName) ?? ctx.serializers.get(info.tableName))
    .find((serializer) => serializer !== undefined);
}

function classNameOf(ctx: PacketContext, classId: number): string {
  return ctx.classes.find((info) => info.classId === classId)?.networkName ?? "";
}

function readClock(file: DemoFile): Clock {
  const startTick = file.commands[0]?.tick ?? 0;
  const endTick = file.commands[file.commands.length - 1]?.tick ?? startTick;
  let mapName: string | null = null;
  let tickInterval = 1 / 64;
  for (const command of file.commands) {
    if (command.command === DEM_FILE_HEADER) mapName = getString(decodeProto(command.body), 5) ?? mapName;
    const data = packetBytes(command);
    if (!data) continue;
    const reader = new BitReader(data);
    while (reader.remainingBits() > 8) {
      const type = readUBitVar(reader);
      const size = readBitVarU32(reader);
      const payload = reader.readBytes(size);
      if (type !== SVC_SERVER_INFO) continue;
      const interval = getFloat(decodeProto(payload), SERVER_INFO_TICK_INTERVAL_FIELD);
      if (interval && interval > 0) tickInterval = interval;
    }
  }
  return { startTick, endTick, tickInterval, mapName };
}

function packetBytes(command: DemoCommand): Uint8Array | undefined {
  if (command.command === DEM_PACKET || command.command === DEM_SIGNON_PACKET) return getBytes(decodeProto(command.body), 3);
  if (command.command === DEM_FULL_PACKET) {
    const packet = getMessages(decodeProto(command.body), 2)[0];
    return packet ? getBytes(packet, 3) : undefined;
  }
  return undefined;
}

function shouldTouch(command: number, baselines: boolean): boolean {
  if (command === DEM_PACKET || command === DEM_SIGNON_PACKET || command === DEM_FULL_PACKET) return true;
  return baselines && command === DEM_STRING_TABLES;
}

function handleIndex(value: FieldValue | undefined): number | null {
  if (!value) return null;
  let raw: number | null = null;
  if (value.kind === "int" || value.kind === "uint") raw = value.value;
  if (value.kind === "uint64") raw = Number(value.value & BigInt(0xffffffff));
  if (raw === null) return null;
  const index = raw & HANDLE_MASK;
  if (index === NO_ENTITY) return null;
  return index;
}

function numberValue(value: FieldValue | undefined): number | null {
  if (!value) return null;
  if (value.kind === "int" || value.kind === "uint" || value.kind === "float") return value.value;
  return null;
}

function stringValue(value: FieldValue | undefined): string {
  return value?.kind === "string" ? value.value : "";
}

function steamValue(value: FieldValue | undefined): string {
  if (!value) return "";
  if (value.kind === "uint64") return value.value.toString();
  if (value.kind === "uint" || value.kind === "int") return String(value.value);
  return "";
}
