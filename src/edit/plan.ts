import { resolvePaint, resolveWeapon } from "../catalog/index.js";
import type { EditOperation, TimeRange } from "../contract.js";
import { assertCosmeticWrite } from "./policy.js";
import { parseDemoTime } from "../time/parse.js";

export type KnownPlayer = {
  name: string;
  steamId: string;
  team: number | null;
};

export type PlannedOp = {
  kind: "strip" | "set";
  range: TimeRange;
  stickers: boolean;
  player: KnownPlayer | null;
  weaponId: number | null;
  paint: number | null;
  seed: number | undefined;
  wear: number | undefined;
  stattrak: number | undefined;
};

export function assertNoIdentityChange(fieldName: string): void {
  assertCosmeticWrite(fieldName);
}

export function resolvePlayerQuery(query: string, players: KnownPlayer[]): KnownPlayer {
  const trimmed = query.trim();
  const steam = players.find((player) => player.steamId !== "" && player.steamId === trimmed);
  if (steam) return steam;
  const needle = trimmed.toLowerCase();
  const matches = players.filter((player) => player.name.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`player not found: ${query}`);
  throw new Error(`ambiguous player ${query}: ${matches.map((player) => player.name).join(", ")}`);
}

export function resolveWeaponFilter(weapon: string | number | undefined): number | null {
  if (weapon === undefined) return null;
  if (typeof weapon === "number") return weapon;
  const numeric = weapon.trim();
  if (/^\d+$/.test(numeric)) {
    const found = resolveWeapon(numeric);
    return found ? found.id : Number(numeric);
  }
  const found = resolveWeapon(numeric);
  if (!found) throw new Error(`unknown weapon ${weapon}`);
  return found.id;
}

export function planOperations(
  operations: EditOperation[],
  players: KnownPlayer[],
  clock: { startTick: number; tickInterval: number },
): PlannedOp[] {
  return operations.map((operation) => {
    const range = {
      fromTick: operation.from ? parseDemoTime(operation.from, clock) : null,
      toTick: operation.to ? parseDemoTime(operation.to, clock) : null,
    };
    if (operation.op === "strip") {
      return { kind: "strip", range, stickers: operation.stickers === true, player: null, weaponId: null, paint: null, seed: undefined, wear: undefined, stattrak: undefined };
    }
    const paint = resolvePaint(String(operation.paint));
    if (!paint) throw new Error(`unknown paint ${operation.paint}`);
    return {
      kind: "set",
      range,
      stickers: false,
      player: resolvePlayerQuery(operation.player, players),
      weaponId: resolveWeaponFilter(operation.weapon),
      paint: paint.id,
      seed: operation.seed,
      wear: operation.wear,
      stattrak: operation.stattrak,
    };
  });
}

export function inWindow(tick: number, range: TimeRange): boolean {
  if (range.fromTick !== null && tick < range.fromTick) return false;
  if (range.toTick !== null && tick > range.toTick) return false;
  return true;
}
