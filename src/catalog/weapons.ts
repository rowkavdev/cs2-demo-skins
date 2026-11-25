import type { WeaponDef } from "../contract.js";

/** CS2 item definition indexes the editor can name. Unused ids are omitted. */
export const WEAPONS: WeaponDef[] = [
  // Pistols
  { id: 1, name: "Desert Eagle", className: "weapon_deagle", aliases: ["deagle"], kind: "pistol" },
  { id: 2, name: "Dual Berettas", className: "weapon_elite", aliases: ["elite", "dualies"], kind: "pistol" },
  { id: 3, name: "Five-SeveN", className: "weapon_fiveseven", aliases: ["fiveseven"], kind: "pistol" },
  { id: 4, name: "Glock-18", className: "weapon_glock", aliases: ["glock"], kind: "pistol" },
  { id: 30, name: "Tec-9", className: "weapon_tec9", aliases: ["tec9"], kind: "pistol" },
  { id: 32, name: "P2000", className: "weapon_hkp2000", aliases: ["p2k", "hkp2000"], kind: "pistol" },
  { id: 36, name: "P250", className: "weapon_p250", aliases: [], kind: "pistol" },
  { id: 61, name: "USP-S", className: "weapon_usp_silencer", aliases: ["usp-s", "usp", "usps"], kind: "pistol" },
  { id: 63, name: "CZ75-Auto", className: "weapon_cz75a", aliases: ["cz", "cz75", "cz75a"], kind: "pistol" },
  { id: 64, name: "R8 Revolver", className: "weapon_revolver", aliases: ["r8", "revolver"], kind: "pistol" },

  // SMGs
  { id: 17, name: "MAC-10", className: "weapon_mac10", aliases: ["mac10"], kind: "smg" },
  { id: 19, name: "P90", className: "weapon_p90", aliases: [], kind: "smg" },
  { id: 23, name: "MP5-SD", className: "weapon_mp5sd", aliases: ["mp5", "mp5sd"], kind: "smg" },
  { id: 24, name: "UMP-45", className: "weapon_ump45", aliases: ["ump", "ump45"], kind: "smg" },
  { id: 26, name: "PP-Bizon", className: "weapon_bizon", aliases: ["bizon", "ppbizon"], kind: "smg" },
  { id: 33, name: "MP7", className: "weapon_mp7", aliases: [], kind: "smg" },
  { id: 34, name: "MP9", className: "weapon_mp9", aliases: [], kind: "smg" },

  // Rifles
  { id: 7, name: "AK-47", className: "weapon_ak47", aliases: ["ak", "ak47", "ak-47"], kind: "rifle" },
  { id: 8, name: "AUG", className: "weapon_aug", aliases: [], kind: "rifle" },
  { id: 10, name: "FAMAS", className: "weapon_famas", aliases: [], kind: "rifle" },
  { id: 13, name: "Galil AR", className: "weapon_galilar", aliases: ["galil", "galilar"], kind: "rifle" },
  { id: 16, name: "M4A4", className: "weapon_m4a1", aliases: ["m4", "m4a4"], kind: "rifle" },
  { id: 39, name: "SG 553", className: "weapon_sg556", aliases: ["sg", "sg553", "krieg"], kind: "rifle" },
  { id: 60, name: "M4A1-S", className: "weapon_m4a1_silencer", aliases: ["m4a1-s", "m4a1s", "m4s"], kind: "rifle" },

  // Snipers
  { id: 9, name: "AWP", className: "weapon_awp", aliases: ["awp"], kind: "sniper" },
  { id: 11, name: "G3SG1", className: "weapon_g3sg1", aliases: ["g3"], kind: "sniper" },
  { id: 38, name: "SCAR-20", className: "weapon_scar20", aliases: ["scar", "scar20"], kind: "sniper" },
  { id: 40, name: "SSG 08", className: "weapon_ssg08", aliases: ["ssg", "ssg08", "scout"], kind: "sniper" },

  // Heavy
  { id: 14, name: "M249", className: "weapon_m249", aliases: [], kind: "heavy" },
  { id: 25, name: "XM1014", className: "weapon_xm1014", aliases: ["xm", "xm1014"], kind: "heavy" },
  { id: 27, name: "MAG-7", className: "weapon_mag7", aliases: ["mag7"], kind: "heavy" },
  { id: 28, name: "Negev", className: "weapon_negev", aliases: [], kind: "heavy" },
  { id: 29, name: "Sawed-Off", className: "weapon_sawedoff", aliases: ["sawedoff", "sawed"], kind: "heavy" },
  { id: 35, name: "Nova", className: "weapon_nova", aliases: [], kind: "heavy" },

  // Gear
  { id: 31, name: "Zeus x27", className: "weapon_taser", aliases: ["zeus", "taser"], kind: "gear" },
  { id: 43, name: "Flashbang", className: "weapon_flashbang", aliases: ["flash"], kind: "gear" },
  { id: 44, name: "High Explosive Grenade", className: "weapon_hegrenade", aliases: ["he", "hegrenade"], kind: "gear" },
  { id: 45, name: "Smoke Grenade", className: "weapon_smokegrenade", aliases: ["smoke"], kind: "gear" },
  { id: 46, name: "Molotov", className: "weapon_molotov", aliases: ["molly"], kind: "gear" },
  { id: 47, name: "Decoy", className: "weapon_decoy", aliases: [], kind: "gear" },
  { id: 48, name: "Incendiary", className: "weapon_incgrenade", aliases: ["inc", "incgrenade"], kind: "gear" },
  { id: 49, name: "C4", className: "weapon_c4", aliases: ["bomb"], kind: "gear" },

  // Knives (Bayonet 500 through Kukri 526, skipping unused ids)
  { id: 500, name: "Bayonet", className: "weapon_bayonet", aliases: [], kind: "knife" },
  { id: 503, name: "Classic Knife", className: "weapon_knife_css", aliases: ["classic"], kind: "knife" },
  { id: 505, name: "Flip Knife", className: "weapon_knife_flip", aliases: ["flip"], kind: "knife" },
  { id: 506, name: "Gut Knife", className: "weapon_knife_gut", aliases: ["gut"], kind: "knife" },
  { id: 507, name: "Karambit", className: "weapon_knife_karambit", aliases: ["kara"], kind: "knife" },
  { id: 508, name: "M9 Bayonet", className: "weapon_knife_m9_bayonet", aliases: ["m9"], kind: "knife" },
  { id: 509, name: "Huntsman Knife", className: "weapon_knife_tactical", aliases: ["huntsman"], kind: "knife" },
  { id: 512, name: "Falchion Knife", className: "weapon_knife_falchion", aliases: ["falchion"], kind: "knife" },
  { id: 514, name: "Bowie Knife", className: "weapon_knife_survival_bowie", aliases: ["bowie"], kind: "knife" },
  { id: 515, name: "Butterfly Knife", className: "weapon_knife_butterfly", aliases: ["butterfly"], kind: "knife" },
  { id: 516, name: "Shadow Daggers", className: "weapon_knife_push", aliases: ["daggers"], kind: "knife" },
  { id: 517, name: "Paracord Knife", className: "weapon_knife_cord", aliases: ["paracord"], kind: "knife" },
  { id: 518, name: "Survival Knife", className: "weapon_knife_canis", aliases: ["survival"], kind: "knife" },
  { id: 519, name: "Ursus Knife", className: "weapon_knife_ursus", aliases: ["ursus"], kind: "knife" },
  { id: 520, name: "Navaja Knife", className: "weapon_knife_gypsy_jackknife", aliases: ["navaja"], kind: "knife" },
  { id: 521, name: "Nomad Knife", className: "weapon_knife_outdoor", aliases: ["nomad"], kind: "knife" },
  { id: 522, name: "Stiletto Knife", className: "weapon_knife_stiletto", aliases: ["stiletto"], kind: "knife" },
  { id: 523, name: "Talon Knife", className: "weapon_knife_widowmaker", aliases: ["talon"], kind: "knife" },
  { id: 525, name: "Skeleton Knife", className: "weapon_knife_skeleton", aliases: ["skeleton"], kind: "knife" },
  { id: 526, name: "Kukri Knife", className: "weapon_knife_kukri", aliases: ["kukri"], kind: "knife" },
];
