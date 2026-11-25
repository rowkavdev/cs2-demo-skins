/**
 * Shared types for cs2-demo-skins.
 * Implementations live in the modules named in SPEC.md.
 * Do not change these names without updating every module.
 */

export const DEMO_MAGIC = "PBDEMS2\0";
export const DEM_IS_COMPRESSED = 64;

export const DEM_STOP = 0;
export const DEM_FILE_HEADER = 1;
export const DEM_FILE_INFO = 2;
export const DEM_SYNC_TICK = 3;
export const DEM_SEND_TABLES = 4;
export const DEM_CLASS_INFO = 5;
export const DEM_STRING_TABLES = 6;
export const DEM_PACKET = 7;
export const DEM_SIGNON_PACKET = 8;
export const DEM_FULL_PACKET = 13;
export const DEM_SPAWN_GROUPS = 15;

export const SVC_SERVER_INFO = 40;
export const SVC_PACKET_ENTITIES = 55;

/** CSVCMsg_ServerInfo.tick_interval */
export const SERVER_INFO_TICK_INTERVAL_FIELD = 13;

export const PACKET_ENTITIES_ENTITY_DATA_FIELD = 7;
export const PACKET_ENTITIES_UPDATED_ENTRIES_FIELD = 2;
export const PACKET_ENTITIES_PVS_FIELD = 16;

export const ENTITY_HANDLE_INDEX_MASK = 0x7fff;
export const INVALID_ENTITY_HANDLE = 0xffffffff;

/**
 * Fields that identify the item itself. Writers must copy these bits unchanged.
 * A skin change that needs a different weapon is a bug, not a feature.
 */
export const PROTECTED_FIELD_NAMES = [
  "m_iItemDefinitionIndex",
  "m_iItemID",
  "m_iItemIDHigh",
  "m_iItemIDLow",
  "m_iAccountID",
] as const;

export const COSMETIC_FIELDS = {
  paint: "m_nFallbackPaintKit",
  seed: "m_nFallbackSeed",
  wear: "m_flFallbackWear",
  stattrak: "m_nFallbackStatTrak",
} as const;

/** Huffman weights for the 40 Source 2 field-path operations, symbol id = index. */
export const FIELD_PATH_WEIGHTS = [
  36271, 10334, 1375, 646, 4128, 35, 3, 521, 2942, 560, 471, 10530, 251, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 310, 2, 0, 1837, 149, 300, 634, 0, 0, 1, 76, 271, 99, 25474,
] as const;

export const FIELD_PATH_OP = {
  plusOne: 0,
  plusTwo: 1,
  plusThree: 2,
  plusFour: 3,
  plusN: 4,
  pushOneLeftDeltaZeroRightZero: 5,
  pushOneLeftDeltaZeroRightNonZero: 6,
  pushOneLeftDeltaOneRightZero: 7,
  pushOneLeftDeltaOneRightNonZero: 8,
  pushOneLeftDeltaNRightZero: 9,
  pushOneLeftDeltaNRightNonZero: 10,
  pushOneLeftDeltaNRightNonZeroPack6Bits: 11,
  pushOneLeftDeltaNRightNonZeroPack8Bits: 12,
  pushTwoLeftDeltaZero: 13,
  pushTwoPack5LeftDeltaZero: 14,
  pushThreeLeftDeltaZero: 15,
  pushThreePack5LeftDeltaZero: 16,
  pushTwoLeftDeltaOne: 17,
  pushTwoPack5LeftDeltaOne: 18,
  pushThreeLeftDeltaOne: 19,
  pushThreePack5LeftDeltaOne: 20,
  pushTwoLeftDeltaN: 21,
  pushTwoPack5LeftDeltaN: 22,
  pushThreeLeftDeltaN: 23,
  pushThreePack5LeftDeltaN: 24,
  pushN: 25,
  pushNAndNonTopological: 26,
  popOnePlusOne: 27,
  popOnePlusN: 28,
  popAllButOnePlusOne: 29,
  popAllButOnePlusN: 30,
  popAllButOnePlusNPack3Bits: 31,
  popAllButOnePlusNPack6Bits: 32,
  popNPlusOne: 33,
  popNPlusN: 34,
  popNAndNonTopographical: 35,
  nonTopoComplex: 36,
  nonTopoPenultimatePlusOne: 37,
  nonTopoComplexPack4Bits: 38,
  finish: 39,
} as const;

export type BitSlice = {
  /** LSB-first packed bits. */
  bytes: Uint8Array;
  bitLength: number;
};

export type FieldPath = number[];

export type FieldValue =
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "uint"; value: number }
  | { kind: "uint64"; value: bigint }
  | { kind: "float"; value: number }
  | { kind: "string"; value: string }
  | { kind: "vector"; value: number[] }
  | { kind: "raw"; bitLength: number };

export type FieldSpec = {
  name: string;
  typeName: string;
  encoder: string | null;
  bitCount: number | null;
  low: number | null;
  high: number | null;
  encodeFlags: number | null;
  signedEnum: boolean;
};

export type ProtoField = {
  field: number;
  wire: 0 | 1 | 2 | 5;
  /** Present for wire 0, 1, and 5. Wire 2 uses bytes. */
  number?: bigint;
  bytes?: Uint8Array;
};

export type DemoCommand = {
  command: number;
  compressed: boolean;
  tick: number;
  /** Uncompressed protobuf body. */
  body: Uint8Array;
};

export type DemoFile = {
  commands: DemoCommand[];
};

export type SerializerField = FieldSpec & {
  index: number;
  serializerName: string | null;
};

export type Serializer = {
  name: string;
  fields: SerializerField[];
};

export type DecodedField = {
  path: FieldPath;
  /** Dotted field names from the serializer, for example m_AttributeManager.m_Item.m_iItemDefinitionIndex. */
  namePath: string[];
  spec: FieldSpec;
  value: FieldValue;
  rawBits: BitSlice;
};

export type EntityRecord =
  | { kind: "update"; index: number; fields: DecodedField[] }
  | {
      kind: "create";
      index: number;
      classId: number;
      serial: number;
      extra: number;
      fields: DecodedField[];
    }
  | { kind: "leave"; index: number }
  | { kind: "delete"; index: number };

export type ClassInfo = {
  classId: number;
  networkName: string;
  tableName: string;
};

export type WeaponDef = {
  id: number;
  name: string;
  className: string;
  aliases: string[];
  kind: "pistol" | "smg" | "rifle" | "heavy" | "sniper" | "gear" | "knife" | "glove" | "other";
};

export type PaintKit = {
  id: number;
  name: string;
  aliases: string[];
  /** Weapon class names this finish was made for. Informational only. */
  weapons: string[];
};

export type TimeRange = {
  /** Inclusive absolute demo command tick. Null means unbounded. */
  fromTick: number | null;
  toTick: number | null;
};

export type StripOperation = {
  op: "strip";
  from?: string;
  to?: string;
  /** Also zero sticker attribute values when present. Default false. */
  stickers?: boolean;
};

export type SetOperation = {
  op: "set";
  /** Player name substring or steam64. */
  player: string;
  /** Paint kit id or catalog name. 0 clears the skin. */
  paint: string | number;
  /** Optional weapon name or definition index. Filters the target. Never written. */
  weapon?: string | number;
  wear?: number;
  seed?: number;
  /** -1 clears StatTrak. */
  stattrak?: number;
  from?: string;
  to?: string;
};

export type EditOperation = StripOperation | SetOperation;

export type EditScript = {
  operations: EditOperation[];
};

export type SkinChange = {
  tick: number;
  entity: number;
  player: string;
  weaponId: number;
  weaponName: string;
  before: { paint: number; seed: number; wear: number; stattrak: number };
  after: { paint: number; seed: number; wear: number; stattrak: number };
};

export type RewriteWarning = {
  tick: number;
  entity: number;
  message: string;
};

export type RewriteResult = {
  output: Uint8Array | null;
  dryRun: boolean;
  changes: SkinChange[];
  warnings: RewriteWarning[];
  players: Array<{ name: string; steamId: string; team: number | null }>;
  mapName: string | null;
  tickInterval: number;
  startTick: number;
  endTick: number;
  /** True when every weapon definition index in the output matches the input. */
  weaponIdentityPreserved: boolean;
};

export type InspectWeapon = {
  tick: number;
  entity: number;
  owner: string | null;
  weaponId: number;
  weaponName: string;
  paint: number;
  paintName: string | null;
  seed: number;
  wear: number;
  stattrak: number;
};

export type InspectReport = {
  mapName: string | null;
  tickInterval: number;
  startTick: number;
  endTick: number;
  durationSeconds: number;
  players: Array<{ name: string; steamId: string }>;
  weapons: InspectWeapon[];
};
