import type { StickerKit } from "../contract.js";

/**
 * Sticker kit ids, not Steam market name ids.
 * "titan holo" is Titan (Holo) | Katowice 2014, kit 76.
 * Other Titan holos (Cologne 2014, Katowice 2015) are different kits and are
 * not aliased to that name. Numeric ids always work, including ones omitted here.
 */
export const STICKERS: StickerKit[] = [
  { id: 0, name: "None", aliases: ["clear", "none"] },
  { id: 75, name: "Titan | Katowice 2014", aliases: ["titan katowice 2014"] },
  { id: 76, name: "Titan (Holo) | Katowice 2014", aliases: ["titan holo", "titan (holo)", "titan holo katowice 2014"] },
  { id: 96, name: "Titan (Foil) | Katowice 2014", aliases: ["titan foil", "titan foil katowice 2014"] },
];
