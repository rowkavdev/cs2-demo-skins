import { describe, expect, it } from "vitest";
import {
  PAINTS,
  WEAPONS,
  paintName,
  resolvePaint,
  resolveWeapon,
  weaponName,
} from "../src/catalog/index.js";

const weaponRows: Array<[number, string, string]> = [
  [1, "Desert Eagle", "pistol"],
  [2, "Dual Berettas", "pistol"],
  [3, "Five-SeveN", "pistol"],
  [4, "Glock-18", "pistol"],
  [30, "Tec-9", "pistol"],
  [32, "P2000", "pistol"],
  [36, "P250", "pistol"],
  [61, "USP-S", "pistol"],
  [63, "CZ75-Auto", "pistol"],
  [64, "R8 Revolver", "pistol"],
  [17, "MAC-10", "smg"],
  [19, "P90", "smg"],
  [23, "MP5-SD", "smg"],
  [24, "UMP-45", "smg"],
  [26, "PP-Bizon", "smg"],
  [33, "MP7", "smg"],
  [34, "MP9", "smg"],
  [7, "AK-47", "rifle"],
  [8, "AUG", "rifle"],
  [10, "FAMAS", "rifle"],
  [13, "Galil AR", "rifle"],
  [16, "M4A4", "rifle"],
  [39, "SG 553", "rifle"],
  [60, "M4A1-S", "rifle"],
  [9, "AWP", "sniper"],
  [11, "G3SG1", "sniper"],
  [38, "SCAR-20", "sniper"],
  [40, "SSG 08", "sniper"],
  [14, "M249", "heavy"],
  [25, "XM1014", "heavy"],
  [27, "MAG-7", "heavy"],
  [28, "Negev", "heavy"],
  [29, "Sawed-Off", "heavy"],
  [35, "Nova", "heavy"],
  [31, "Zeus x27", "gear"],
  [43, "Flashbang", "gear"],
  [44, "High Explosive Grenade", "gear"],
  [45, "Smoke Grenade", "gear"],
  [46, "Molotov", "gear"],
  [47, "Decoy", "gear"],
  [48, "Incendiary", "gear"],
  [49, "C4", "gear"],
  [500, "Bayonet", "knife"],
  [503, "Classic Knife", "knife"],
  [505, "Flip Knife", "knife"],
  [506, "Gut Knife", "knife"],
  [507, "Karambit", "knife"],
  [508, "M9 Bayonet", "knife"],
  [509, "Huntsman Knife", "knife"],
  [512, "Falchion Knife", "knife"],
  [514, "Bowie Knife", "knife"],
  [515, "Butterfly Knife", "knife"],
  [516, "Shadow Daggers", "knife"],
  [517, "Paracord Knife", "knife"],
  [518, "Survival Knife", "knife"],
  [519, "Ursus Knife", "knife"],
  [520, "Navaja Knife", "knife"],
  [521, "Nomad Knife", "knife"],
  [522, "Stiletto Knife", "knife"],
  [523, "Talon Knife", "knife"],
  [525, "Skeleton Knife", "knife"],
  [526, "Kukri Knife", "knife"],
];

describe("catalog weapons", () => {
  it("lists every required definition index once", () => {
    expect(WEAPONS).toHaveLength(weaponRows.length);
    expect(new Set(WEAPONS.map((weapon) => weapon.id)).size).toBe(WEAPONS.length);
    for (const [id, name, kind] of weaponRows) {
      expect(WEAPONS.find((weapon) => weapon.id === id)).toMatchObject({ name, kind });
      expect(weaponName(id)).toBe(name);
    }
  });

  it("resolves id, display name, and aliases case-insensitively", () => {
    expect(resolveWeapon("ak-47")?.id).toBe(7);
    expect(resolveWeapon("AK")?.id).toBe(7);
    expect(resolveWeapon("ak47")?.name).toBe("AK-47");
    expect(resolveWeapon("AK-47")?.className).toBe("weapon_ak47");
    expect(resolveWeapon("9")?.name).toContain("AWP");
    expect(resolveWeapon("awp")?.id).toBe(9);
    expect(resolveWeapon("m4a1-s")?.id).toBe(60);
    expect(resolveWeapon("M4A1-S")?.name).toBe("M4A1-S");
    expect(resolveWeapon("usp-s")?.id).toBe(61);
    expect(resolveWeapon("Desert Eagle")?.id).toBe(1);
    expect(resolveWeapon("kukri")?.id).toBe(526);
    expect(resolveWeapon("weapon_awp")?.id).toBe(9);
    expect(resolveWeapon("999999")).toBeUndefined();
    expect(resolveWeapon("not a gun")).toBeUndefined();
    expect(weaponName(999999)).toBeNull();
  });
});

describe("catalog paints", () => {
  it("resolves known kits, synthetic ids, and unknown names", () => {
    expect(resolvePaint("howl")?.id).toBe(309);
    expect(resolvePaint("309")).toMatchObject({
      id: 309,
      name: "Howl",
      weapons: ["weapon_ak47"],
    });
    expect(resolvePaint("dlore")?.id).toBe(344);
    expect(resolvePaint("dragonlore")?.name).toBe("Dragon Lore");
    expect(resolvePaint("asiimov")?.id).toBe(279);
    expect(resolvePaint("redline")?.id).toBe(282);
    expect(resolvePaint("vulcan")?.id).toBe(302);
    expect(resolvePaint("fade")?.id).toBe(38);
    expect(resolvePaint("hyper beast")).toBeUndefined();
    expect(resolvePaint("m4 hyper beast")?.id).toBe(430);
    expect(resolvePaint("awp hyper beast")?.id).toBe(475);
    expect(resolvePaint("430")?.name).toBe("Hyper Beast");
    expect(resolvePaint("475")?.weapons).toEqual(["weapon_awp"]);
    expect(resolvePaint("999999")).toEqual({
      id: 999999,
      name: "999999",
      aliases: [],
      weapons: [],
    });
    expect(resolvePaint("not a skin")).toBeUndefined();
    expect(resolvePaint("")).toBeUndefined();
    expect(paintName(344)).toBe("Dragon Lore");
    expect(paintName(309)).toBe("Howl");
    expect(paintName(0)).toBe("Default");
    expect(paintName(999999)).toBeNull();
    expect(PAINTS.map((paint) => paint.id)).toEqual([
      0, 12, 38, 44, 59, 180, 279, 282, 302, 309, 344, 430, 475,
    ]);
  });
});
