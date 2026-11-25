import type { PaintKit } from "../contract.js";

/**
 * Curated paint kits with known ids. Shared finish names (Hyper Beast) stay
 * ambiguous unless the alias names the weapon. Uncertain ids are omitted.
 */
export const PAINTS: PaintKit[] = [
  { id: 0, name: "Default", aliases: [], weapons: [] },
  { id: 12, name: "Crimson Web", aliases: [], weapons: [] },
  { id: 38, name: "Fade", aliases: ["fade"], weapons: [] },
  { id: 44, name: "Case Hardened", aliases: [], weapons: [] },
  { id: 59, name: "Slaughter", aliases: [], weapons: [] },
  { id: 180, name: "Fire Serpent", aliases: [], weapons: ["weapon_ak47"] },
  { id: 279, name: "Asiimov", aliases: ["asiimov"], weapons: ["weapon_awp"] },
  { id: 282, name: "Redline", aliases: ["redline"], weapons: ["weapon_ak47"] },
  { id: 302, name: "Vulcan", aliases: ["vulcan"], weapons: ["weapon_ak47"] },
  { id: 309, name: "Howl", aliases: ["howl"], weapons: ["weapon_ak47"] },
  { id: 344, name: "Dragon Lore", aliases: ["dlore", "dragonlore"], weapons: ["weapon_awp"] },
  { id: 430, name: "Hyper Beast", aliases: ["m4 hyper beast"], weapons: ["weapon_m4a1"] },
  { id: 475, name: "Hyper Beast", aliases: ["awp hyper beast"], weapons: ["weapon_awp"] },
];
