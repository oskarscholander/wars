import { PERMISSION_MODES, UNIT_MODELS, type ClientCommand, type PermissionMode, type UnitModel } from "@ww/shared";

const str = (v: unknown, max = 10_000): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Validates untrusted client input. Returns null for anything malformed. */
export function parseClientCommand(raw: unknown): ClientCommand | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "repo.add":
      return str(m.path, 4096) ? { type: m.type, path: m.path } : null;
    case "repo.remove":
      return str(m.repoId, 64) ? { type: m.type, repoId: m.repoId } : null;
    case "repo.update":
      return str(m.repoId, 64) && Array.isArray(m.testCommand) && m.testCommand.length <= 64 && m.testCommand.every((a) => typeof a === "string" && a.length <= 4096)
        ? { type: m.type, repoId: m.repoId, testCommand: m.testCommand as string[] }
        : null;
    case "repo.suggest":
      return { type: m.type };
    case "front.delete":
      if (!str(m.frontId, 64)) return null;
      if (m.force !== undefined && typeof m.force !== "boolean") return null;
      if (m.deleteBranch !== undefined && typeof m.deleteBranch !== "boolean") return null;
      return { type: m.type, frontId: m.frontId, force: m.force === true, deleteBranch: m.deleteBranch === true };
    case "front.create":
      return str(m.repoId, 64) && str(m.branch, 200) ? { type: m.type, repoId: m.repoId, branch: m.branch } : null;
    case "unit.create":
      if (m.permissionMode !== undefined && !PERMISSION_MODES.includes(m.permissionMode as PermissionMode)) return null;
      return str(m.frontId, 64) && str(m.name, 80) && UNIT_MODELS.includes(m.model as UnitModel)
        ? {
            type: m.type,
            frontId: m.frontId,
            name: m.name,
            model: m.model as UnitModel,
            ...(m.permissionMode ? { permissionMode: m.permissionMode as PermissionMode } : {}),
          }
        : null;
    case "unit.update":
      return str(m.unitId, 64) && PERMISSION_MODES.includes(m.permissionMode as PermissionMode)
        ? { type: m.type, unitId: m.unitId, permissionMode: m.permissionMode as PermissionMode }
        : null;
    case "unit.order":
      return str(m.unitId, 64) && str(m.text, 100_000) ? { type: m.type, unitId: m.unitId, text: m.text } : null;
    case "permission.resolve":
      if (!str(m.id, 64) || typeof m.allow !== "boolean") return null;
      if (m.message !== undefined && typeof m.message !== "string") return null;
      return { type: m.type, id: m.id, allow: m.allow, ...(m.message ? { message: m.message } : {}) };
    case "diff.request":
    case "tests.run":
    case "pr.open":
    case "pr.merge":
      return str(m.frontId, 64) ? { type: m.type, frontId: m.frontId } : null;
    default:
      return null;
  }
}
