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
    const stickers = weapon.stickers.length > 0 ? `  stickers ${weapon.stickers.join(",")}` : "";
    const quality = weapon.quality !== null ? `  quality ${weapon.quality}` : "";
    lines.push(
      `  tick ${weapon.tick}  ${weapon.owner ?? "unknown"}  ${weapon.weaponName}  ${weapon.paintName ?? weapon.paint}  wear ${weapon.wear}  seed ${weapon.seed}  stattrak ${weapon.stattrak}${stickers}${quality}`,
    );
  }
  return lines.join("\n");
}

export function formatRewrite(result: RewriteResult): string {
  const lines = [`${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`];
  let knifeChanged = false;
  for (const change of result.changes) {
    const parts = [
      `tick ${change.tick}  ${change.player || "unknown"}  ${change.weaponName}  ${change.before.paint} -> ${change.after.paint}`,
    ];
    if (change.definition && change.definition.before !== change.definition.after) {
      parts.push(`def ${change.definition.before} -> ${change.definition.after}`);
      knifeChanged = true;
    }
    if (change.stickers) parts.push(`stickers ${change.stickers.after.join(",")}`);
    lines.push(parts.join("  "));
  }
  if (result.weaponIdentityPreserved) {
    lines.push(
      knifeChanged
        ? "knife definition indexes changed; other weapons were left unchanged"
        : "weapon definition indexes were left unchanged",
    );
  }
  if (result.dryRun) lines.push("dry run: no file written");
  return lines.join("\n");
}
