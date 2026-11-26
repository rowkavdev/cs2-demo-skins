#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAINTS, WEAPONS, resolveWeapon } from "./catalog/index.js";
import type { EditScript } from "./contract.js";
import { inspectDemo } from "./edit/inspect.js";
import { formatInspect, formatRewrite } from "./edit/report.js";
import { rewriteDemo } from "./edit/session.js";

type Flags = Map<string, string | boolean>;

const args = process.argv.slice(2);
const command = args[0];

try {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }
  if (command === "weapons") {
    for (const weapon of WEAPONS) console.log(`${weapon.id}\t${weapon.name}`);
    process.exit(0);
  }
  if (command === "paints") {
    const flags = parseFlags(args.slice(1));
    const search = stringFlag(flags, "search")?.toLowerCase() ?? "";
    const weapon = stringFlag(flags, "weapon");
    const weaponId = weapon ? resolveWeapon(weapon)?.className : undefined;
    for (const paint of PAINTS) {
      const haystack = `${paint.name} ${paint.aliases.join(" ")}`.toLowerCase();
      if (search && !haystack.includes(search) && String(paint.id) !== search) continue;
      if (weaponId && paint.weapons.length > 0 && !paint.weapons.includes(weaponId)) continue;
      console.log(`${paint.id}\t${paint.name}`);
    }
    process.exit(0);
  }
  if (command === "inspect") {
    const file = args[1];
    if (!file || file.startsWith("-")) fail("usage: cs2skin inspect <demo> [--json]");
    const flags = parseFlags(args.slice(2));
    const report = inspectDemo(readFileSync(file));
    console.log(flags.has("json") ? JSON.stringify(report, null, 2) : formatInspect(report));
    process.exit(0);
  }
  if (command === "strip" || command === "set" || command === "apply") {
    runWrite(command, args.slice(1));
  }
  fail(`unknown command ${command}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

function runWrite(command: string, rest: string[]): void {
  const demo = rest[0];
  if (!demo || demo.startsWith("-")) fail(`usage: cs2skin ${command} <demo> -o <out>`);
  const flags = parseFlags(rest.slice(1));
  const dryRun = flags.has("dry-run");
  const outputPath = stringFlag(flags, "o");
  if (!dryRun && !outputPath) fail("writes require -o");
  if (outputPath && resolve(outputPath) === resolve(demo)) fail("refusing to overwrite the input demo");
  const script = scriptFrom(command, flags);
  const result = rewriteDemo(readFileSync(demo), script, { dryRun });
  if (!result.weaponIdentityPreserved) fail("weapon definition index changed");
  for (const warning of result.warnings) console.error(`warning tick ${warning.tick}: ${warning.message}`);
  console.log(formatRewrite(result));
  if (!dryRun && outputPath && result.output) writeFileSync(outputPath, result.output);
}

function scriptFrom(command: string, flags: Flags): EditScript {
  if (command === "apply") {
    const scriptPath = stringFlag(flags, "script");
    if (!scriptPath) fail("apply requires --script");
    const parsed = JSON.parse(readFileSync(scriptPath, "utf8")) as EditScript;
    if (!parsed || !Array.isArray(parsed.operations)) fail("script must contain operations");
    return parsed;
  }
  if (command === "strip") {
    return {
      operations: [
        {
          op: "strip",
          from: stringFlag(flags, "from"),
          to: stringFlag(flags, "to"),
          stickers: flags.has("stickers"),
        },
      ],
    };
  }
  const player = stringFlag(flags, "player");
  const paint = stringFlag(flags, "paint");
  if (!player) fail("set requires --player");
  if (paint === undefined) fail("set requires --paint");
  const wear = numberFlag(flags, "wear");
  const seed = numberFlag(flags, "seed");
  const stattrak = numberFlag(flags, "stattrak");
  const weapon = stringFlag(flags, "weapon");
  return {
    operations: [
      {
        op: "set",
        player,
        paint: /^-?\d+$/.test(paint) ? Number(paint) : paint,
        weapon,
        wear,
        seed,
        stattrak,
        from: stringFlag(flags, "from"),
        to: stringFlag(flags, "to"),
      },
    ],
  };
}

function parseFlags(parts: string[]): Flags {
  const flags: Flags = new Map();
  for (let index = 0; index < parts.length; index++) {
    const token = parts[index];
    if (!token?.startsWith("--")) fail(`unexpected argument ${token ?? ""}`);
    const name = token.slice(2);
    const next = parts[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, true);
      continue;
    }
    flags.set(name, next);
    index++;
  }
  return flags;
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(flags: Flags, name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`bad number for --${name}`);
  return parsed;
}

function fail(message: string): never {
  throw new Error(message);
}

function printHelp(): void {
  console.log(`cs2skin inspect <demo> [--json]
cs2skin weapons
cs2skin paints [--search text] [--weapon name]
cs2skin strip <demo> -o <out> [--from t] [--to t] [--stickers] [--dry-run]
cs2skin set <demo> -o <out> --player <name> --paint <id|name> [--weapon name] [--wear n] [--seed n] [--stattrak n] [--from t] [--to t] [--dry-run]
cs2skin apply <demo> -o <out> --script changes.json [--dry-run]`);
}
