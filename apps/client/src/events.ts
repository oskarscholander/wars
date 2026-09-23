/** Transient daemon happenings that drive animation only (never state). */
export const toolEvents = new EventTarget();

export const emitTool = (unitId: string) => toolEvents.dispatchEvent(new CustomEvent<string>("tool", { detail: unitId }));

export function onTool(unitId: string, cb: () => void): () => void {
  const handler = (e: Event) => (e as CustomEvent<string>).detail === unitId && cb();
  toolEvents.addEventListener("tool", handler);
  return () => toolEvents.removeEventListener("tool", handler);
}
