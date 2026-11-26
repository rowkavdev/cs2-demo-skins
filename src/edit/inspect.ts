import type { InspectReport } from "../contract.js";
import { describeDemo } from "./session.js";

export function inspectDemo(input: Uint8Array): InspectReport {
  const described = describeDemo(input);
  const span = described.endTick - described.startTick;
  return {
    mapName: described.mapName,
    tickInterval: described.tickInterval,
    startTick: described.startTick,
    endTick: described.endTick,
    durationSeconds: span * described.tickInterval,
    players: described.players.map((player) => ({ name: player.name, steamId: player.steamId })),
    weapons: described.weapons,
  };
}
