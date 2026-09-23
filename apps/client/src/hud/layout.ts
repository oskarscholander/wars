/** Terminals column width for a viewport: shown beside the map on wide screens only. */
export function terminalColumnWidth(viewportWidth: number): number {
  if (viewportWidth < 900) return 0;
  return Math.round(Math.min(640, Math.max(380, viewportWidth * 0.38)));
}
