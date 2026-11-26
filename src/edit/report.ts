import type { InspectReport, RewriteResult } from "../contract.js";

export function formatInspect(report: InspectReport): string {
  const lines = [
    `map: ${report.mapName ?? "unknown"}`,
    `ticks: ${report.startTick}..${report.endTick} (${report.durationSeconds.toFixed(2)}s)`,
    "players:",
  ];
  if (report.players.length === 0) lines.push("  none");
  for (const player of report.players) {
    lines.push(`  ${player.name}${player.steamId ? `  ${player.steamId}` : ""}`);
  }
  lines.push("weapons:");
  if (report.weapons.length === 0) lines.push("  none");
  for (const weapon of report.weapons) {
    lines.push(
      `  tick ${weapon.tick}  ${weapon.owner ?? "unknown"}  ${weapon.weaponName}  ${weapon.paintName ?? weapon.paint}  wear ${weapon.wear}  seed ${weapon.seed}  stattrak ${weapon.stattrak}`,
    );
  }
  return lines.join("\n");
}

export function formatRewrite(result: RewriteResult): string {
  const lines = [`${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`];
  for (const change of result.changes) {
    lines.push(
      `tick ${change.tick}  ${change.player || "unknown"}  ${change.weaponName}  ${change.before.paint} -> ${change.after.paint}`,
    );
  }
  if (result.weaponIdentityPreserved) lines.push("weapon definition indexes were left unchanged");
  if (result.dryRun) lines.push("dry run: no file written");
  return lines.join("\n");
}
