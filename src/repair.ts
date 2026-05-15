import fs from "node:fs";

import Database from "better-sqlite3";

import { normalizeTitle, recoverPreview, isBlank } from "./preview.js";
import { filterThreadsForProject } from "./scan.js";
import { createBackups, getThreadWorkspaceRootHints } from "./storage.js";
import { findContainingSavedRoot } from "./project.js";
import type { GlobalState, LoadedCodexData, RepairAction, RepairPlan } from "./types.js";

export type RepairOptions = {
  project?: string;
  backup?: boolean;
  dryRun?: boolean;
  fixHints?: boolean;
  fixCwd?: boolean;
};

export type RepairResult = {
  plan: RepairPlan;
  dryRun: boolean;
  backupDir: string | null;
  appliedActions: RepairAction[];
};

export async function repairCodexData(data: LoadedCodexData, options: RepairOptions): Promise<RepairResult> {
  const plan = createRepairPlan(data, options);
  const writeMode = options.backup === true && options.dryRun !== true;

  if (!writeMode) {
    return {
      plan,
      dryRun: true,
      backupDir: null,
      appliedActions: []
    };
  }

  const backupDir = await createBackups(data.paths.codexHome, data.paths.stateDbPath, data.paths.globalStatePath);
  applyRepairPlan(data, plan, options);

  return {
    plan,
    dryRun: false,
    backupDir,
    appliedActions: plan.actions
  };
}

export function createRepairPlan(data: LoadedCodexData, options: RepairOptions = {}): RepairPlan {
  const threads = filterThreadsForProject(data, options.project);
  const hints = getThreadWorkspaceRootHints(data.globalState);
  const actions: RepairAction[] = [];
  const unappliedOptionalActions: RepairAction[] = [];

  for (const thread of threads) {
    const transcript = data.transcriptsByThreadId.get(thread.id);
    const previewRecovery = isBlank(thread.preview) ? recoverPreview(thread.first_user_message, transcript) : null;
    const recoveredPreview = previewRecovery?.value ?? thread.preview ?? "";

    if (previewRecovery) {
      actions.push({
        type: "fill-preview",
        threadId: thread.id,
        value: previewRecovery.value,
        source: previewRecovery.source
      });
    }

    if (isBlank(thread.title) && !isBlank(recoveredPreview)) {
      actions.push({
        type: "fill-title",
        threadId: thread.id,
        value: normalizeTitle(recoveredPreview),
        source: "preview"
      });
    }

    const savedRoot = findContainingSavedRoot(thread.cwd, data.savedProjectRoots);
    if (savedRoot && hints[thread.id] !== savedRoot) {
      const action: RepairAction = {
        type: "set-workspace-root-hint",
        threadId: thread.id,
        value: savedRoot,
        source: "saved-project-root"
      };
      if (options.fixHints) {
        actions.push(action);
      } else {
        unappliedOptionalActions.push(action);
      }
    }

    if (savedRoot && thread.cwd && thread.cwd !== savedRoot) {
      const action: RepairAction = {
        type: "remap-cwd",
        threadId: thread.id,
        from: thread.cwd,
        to: savedRoot,
        source: "saved-project-root"
      };
      if (options.fixCwd) {
        actions.push(action);
      } else {
        unappliedOptionalActions.push(action);
      }
    }
  }

  return { actions, unappliedOptionalActions };
}

export function applyRepairPlan(data: LoadedCodexData, plan: RepairPlan, options: RepairOptions): void {
  const db = new Database(data.paths.stateDbPath, { fileMustExist: true });
  try {
    const updatePreview = db.prepare("UPDATE threads SET preview = ? WHERE id = ? AND (preview IS NULL OR trim(preview) = '')");
    const updateTitle = db.prepare("UPDATE threads SET title = ? WHERE id = ? AND (title IS NULL OR trim(title) = '')");
    const updateCwd = db.prepare("UPDATE threads SET cwd = ? WHERE id = ?");

    const tx = db.transaction(() => {
      for (const action of plan.actions) {
        if (action.type === "fill-preview") {
          updatePreview.run(action.value, action.threadId);
        } else if (action.type === "fill-title") {
          updateTitle.run(action.value, action.threadId);
        } else if (action.type === "remap-cwd" && options.fixCwd) {
          updateCwd.run(action.to, action.threadId);
        }
      }
    });

    tx();
  } finally {
    db.close();
  }

  if (options.fixHints) {
    writeGlobalStateHints(data.globalState, data.paths.globalStatePath, plan.actions);
  }
}

export function writeGlobalStateHints(globalState: GlobalState, globalStatePath: string, actions: RepairAction[]): void {
  const hintActions = actions.filter((action): action is Extract<RepairAction, { type: "set-workspace-root-hint" }> => {
    return action.type === "set-workspace-root-hint";
  });

  if (hintActions.length === 0) {
    return;
  }

  const nextState = { ...globalState };
  const existingHints = nextState["thread-workspace-root-hints"];
  const hints =
    typeof existingHints === "object" && existingHints != null && !Array.isArray(existingHints)
      ? { ...(existingHints as Record<string, unknown>) }
      : {};

  for (const action of hintActions) {
    hints[action.threadId] = action.value;
  }

  nextState["thread-workspace-root-hints"] = hints;
  fs.writeFileSync(globalStatePath, `${JSON.stringify(nextState, null, 2)}\n`);
}

export function formatRepairResult(result: RepairResult): string {
  const lines: string[] = [];
  lines.push(result.dryRun ? "Codex relink repair dry-run" : "Codex relink repair applied");
  if (result.backupDir) {
    lines.push(`Backup directory: ${result.backupDir}`);
  }
  lines.push("");
  lines.push(`Actions ${result.dryRun ? "proposed" : "applied"}: ${result.plan.actions.length}`);

  const counts = countActionTypes(result.plan.actions);
  for (const [type, count] of Object.entries(counts)) {
    lines.push(`- ${type}: ${count}`);
  }

  if (result.plan.unappliedOptionalActions.length > 0) {
    lines.push("");
    lines.push(`Optional actions left untouched: ${result.plan.unappliedOptionalActions.length}`);
    const optionalCounts = countActionTypes(result.plan.unappliedOptionalActions);
    for (const [type, count] of Object.entries(optionalCounts)) {
      lines.push(`- ${type}: ${count}`);
    }
  }

  if (result.plan.actions.length > 0) {
    lines.push("");
    lines.push("Action samples:");
    for (const action of result.plan.actions.slice(0, 20)) {
      lines.push(`- ${formatAction(action)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function countActionTypes(actions: RepairAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) {
    counts[action.type] = (counts[action.type] ?? 0) + 1;
  }
  return counts;
}

function formatAction(action: RepairAction): string {
  if (action.type === "fill-preview") {
    return `${action.type} ${action.threadId} from ${action.source}: ${action.value}`;
  }

  if (action.type === "fill-title") {
    return `${action.type} ${action.threadId}: ${action.value}`;
  }

  if (action.type === "set-workspace-root-hint") {
    return `${action.type} ${action.threadId}: ${action.value}`;
  }

  return `${action.type} ${action.threadId}: ${action.from} -> ${action.to}`;
}
