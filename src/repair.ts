import fs from "node:fs";

import Database from "better-sqlite3";

import { hasUsableDisplayPreview, hasUsableDisplayTitle, normalizePreview, normalizeTitle, recoverPreview } from "./preview.js";
import { filterThreadsForProject } from "./scan.js";
import { createBackups, getThreadWorkspaceRootHints } from "./storage.js";
import { findContainingSavedRoot } from "./project.js";
import { isDefaultRepairCandidate } from "./threadFilters.js";
import type { GlobalState, LoadedCodexData, RepairAction, RepairPlan, ThreadRow } from "./types.js";

const GENERIC_PREVIEW = "Recovered Codex conversation";

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
  const appliedActions = applyRepairPlan(data, plan, options);

  return {
    plan,
    dryRun: false,
    backupDir,
    appliedActions
  };
}

export async function applySelectedRepairActions(data: LoadedCodexData, actions: RepairAction[]): Promise<RepairResult> {
  const plan: RepairPlan = {
    actions,
    unappliedOptionalActions: []
  };
  const backupDir = await createBackups(data.paths.codexHome, data.paths.stateDbPath, data.paths.globalStatePath);

  const appliedActions = applyRepairPlan(data, plan, {
    backup: true,
    dryRun: false,
    fixHints: actions.some((action) => action.type === "set-workspace-root-hint"),
    fixCwd: actions.some((action) => action.type === "remap-cwd")
  });

  return {
    plan,
    dryRun: false,
    backupDir,
    appliedActions
  };
}

export function createRepairPlan(data: LoadedCodexData, options: RepairOptions = {}): RepairPlan {
  const threads = sortThreadsForRepair(filterThreadsForProject(data, options.project));
  const hints = getThreadWorkspaceRootHints(data.globalState);
  const actions: RepairAction[] = [];
  const unappliedOptionalActions: RepairAction[] = [];
  let recoveredTitleNumber = 1;

  for (const thread of threads) {
    if (!isDefaultRepairCandidate(thread, { hasThreadGoal: data.threadGoalsByThreadId.has(thread.id) })) {
      continue;
    }

    const transcript = data.transcriptsByThreadId.get(thread.id);
    const previewRecovery = recoverPreview(thread.first_user_message, transcript);
    const normalizedExistingPreview = hasUsableDisplayPreview(thread.preview) ? normalizePreview(thread.preview ?? "") : null;
    const existingUsablePreview = normalizedExistingPreview === GENERIC_PREVIEW ? null : normalizedExistingPreview;
    let plannedTitle: string | null = hasUsableDisplayTitle(thread.title) ? thread.title : null;

    if (!hasUsableDisplayTitle(thread.title)) {
      const recoveredTitleText = previewRecovery?.value ?? existingUsablePreview;
      if (recoveredTitleText) {
        plannedTitle = normalizeTitle(recoveredTitleText);
        actions.push({
          type: "fill-title",
          threadId: thread.id,
          value: plannedTitle,
          source: "preview"
        });
      } else {
        plannedTitle = `Recovered title #${recoveredTitleNumber}`;
        recoveredTitleNumber += 1;
        actions.push({
          type: "fill-generic-title",
          threadId: thread.id,
          value: plannedTitle,
          source: "desktop-visibility"
        });
      }
    }

    if (!hasUsableDisplayPreview(thread.preview)) {
      if (previewRecovery) {
        actions.push({
          type: "fill-preview",
          threadId: thread.id,
          value: previewRecovery.value,
          source: previewRecovery.source
        });
      } else {
        actions.push({
          type: "fill-generic-preview",
          threadId: thread.id,
          value: GENERIC_PREVIEW,
          source: "desktop-visibility"
        });
      }
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

    if (thread.archived !== 1 && !data.sessionIndexIds.has(thread.id)) {
      actions.push({
        type: "add-session-index-entry",
        threadId: thread.id,
        threadName: deriveSessionThreadName(thread, plannedTitle),
        updatedAt: formatSessionIndexUpdatedAt(thread),
        source: "sqlite-thread"
      });
    }
  }

  return { actions, unappliedOptionalActions };
}

export function applyRepairPlan(data: LoadedCodexData, plan: RepairPlan, options: RepairOptions): RepairAction[] {
  const appliedActions: RepairAction[] = [];
  const db = new Database(data.paths.stateDbPath, { fileMustExist: true });
  try {
    const updatePreview = db.prepare(
      `UPDATE threads
          SET preview = ?
        WHERE id = ?
          AND ${unusableColumnSql("preview")}`
    );
    const updateTitle = db.prepare(
      `UPDATE threads
          SET title = ?
        WHERE id = ?
          AND ${unusableColumnSql("title")}`
    );
    const updateCwd = db.prepare("UPDATE threads SET cwd = ? WHERE id = ?");

    const tx = db.transaction(() => {
      for (const action of plan.actions) {
        if (action.type === "fill-preview") {
          const result = updatePreview.run(action.value, action.threadId);
          if (result.changes > 0) {
            appliedActions.push(action);
          }
        } else if (action.type === "fill-title") {
          const result = updateTitle.run(action.value, action.threadId);
          if (result.changes > 0) {
            appliedActions.push(action);
          }
        } else if (action.type === "fill-generic-preview") {
          const result = updatePreview.run(action.value, action.threadId);
          if (result.changes > 0) {
            appliedActions.push(action);
          }
        } else if (action.type === "fill-generic-title") {
          const result = updateTitle.run(action.value, action.threadId);
          if (result.changes > 0) {
            appliedActions.push(action);
          }
        } else if (action.type === "remap-cwd" && options.fixCwd) {
          const result = updateCwd.run(action.to, action.threadId);
          if (result.changes > 0) {
            appliedActions.push(action);
          }
        }
      }
    });

    tx();
  } finally {
    db.close();
  }

  if (options.fixHints) {
    appliedActions.push(...writeGlobalStateHints(data.globalState, data.paths.globalStatePath, plan.actions));
  }

  appliedActions.push(...writeSessionIndexEntries(data.paths.sessionIndexPath, plan.actions));
  return appliedActions;
}

export function writeGlobalStateHints(globalState: GlobalState, globalStatePath: string, actions: RepairAction[]): RepairAction[] {
  const hintActions = actions.filter((action): action is Extract<RepairAction, { type: "set-workspace-root-hint" }> => {
    return action.type === "set-workspace-root-hint";
  });

  if (hintActions.length === 0) {
    return [];
  }

  const nextState = { ...globalState };
  const existingHints = nextState["thread-workspace-root-hints"];
  const hints =
    typeof existingHints === "object" && existingHints != null && !Array.isArray(existingHints)
      ? { ...(existingHints as Record<string, unknown>) }
      : {};
  const appliedActions: RepairAction[] = [];

  for (const action of hintActions) {
    if (hints[action.threadId] === action.value) {
      continue;
    }
    hints[action.threadId] = action.value;
    appliedActions.push(action);
  }

  if (appliedActions.length === 0) {
    return [];
  }

  nextState["thread-workspace-root-hints"] = hints;
  fs.writeFileSync(globalStatePath, `${JSON.stringify(nextState, null, 2)}\n`);
  return appliedActions;
}

export function writeSessionIndexEntries(sessionIndexPath: string, actions: RepairAction[]): RepairAction[] {
  const entries = actions.filter((action): action is Extract<RepairAction, { type: "add-session-index-entry" }> => {
    return action.type === "add-session-index-entry";
  });

  if (entries.length === 0) {
    return [];
  }

  const existing = fs.existsSync(sessionIndexPath) ? fs.readFileSync(sessionIndexPath, "utf8") : "";
  const existingIds = new Set<string>();
  for (const line of existing.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed != null && "id" in parsed && typeof parsed.id === "string") {
        existingIds.add(parsed.id);
      }
    } catch {
      continue;
    }
  }

  const appliedActions: RepairAction[] = [];
  const lines: string[] = [];
  for (const entry of entries) {
    if (existingIds.has(entry.threadId)) {
      continue;
    }
    existingIds.add(entry.threadId);
    appliedActions.push(entry);
    lines.push(
      JSON.stringify({
        id: entry.threadId,
        thread_name: entry.threadName,
        updated_at: entry.updatedAt
      })
    );
  }

  if (lines.length === 0) {
    return [];
  }

  const prefix = existing.trimEnd();
  const nextBody = `${prefix}${prefix ? "\n" : ""}${lines.join("\n")}\n`;
  fs.writeFileSync(sessionIndexPath, nextBody);
  return appliedActions;
}

export function formatRepairResult(result: RepairResult): string {
  const lines: string[] = [];
  lines.push(result.dryRun ? "Codex relink repair dry-run" : "Codex relink repair applied");
  if (result.backupDir) {
    lines.push(`Backup directory: ${result.backupDir}`);
  }
  lines.push("");
  const displayedActions = result.dryRun ? result.plan.actions : result.appliedActions;
  lines.push(`Actions ${result.dryRun ? "proposed" : "applied"}: ${displayedActions.length}`);

  const counts = countActionTypes(displayedActions);
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

  if (displayedActions.length > 0) {
    lines.push("");
    lines.push("Action samples:");
    for (const action of displayedActions.slice(0, 20)) {
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

  if (action.type === "fill-generic-preview") {
    return `${action.type} ${action.threadId}: ${action.value}`;
  }

  if (action.type === "fill-generic-title") {
    return `${action.type} ${action.threadId}: ${action.value}`;
  }

  if (action.type === "set-workspace-root-hint") {
    return `${action.type} ${action.threadId}: ${action.value}`;
  }

  if (action.type === "remap-cwd") {
    return `${action.type} ${action.threadId}: ${action.from} -> ${action.to}`;
  }

  return `${action.type} ${action.threadId}: ${action.threadName}`;
}

function deriveSessionThreadName(thread: { title: string | null }, plannedTitle: string | null): string {
  if (hasUsableDisplayTitle(plannedTitle)) {
    return normalizeTitle(plannedTitle ?? "");
  }

  if (hasUsableDisplayTitle(thread.title)) {
    return normalizeTitle(thread.title ?? "");
  }

  return "Recovered Codex thread";
}

function formatSessionIndexUpdatedAt(thread: Pick<ThreadRow, "updated_at" | "updated_at_ms">): string {
  if (typeof thread.updated_at_ms === "number" && Number.isFinite(thread.updated_at_ms)) {
    return new Date(thread.updated_at_ms).toISOString();
  }

  if (typeof thread.updated_at === "number" && Number.isFinite(thread.updated_at)) {
    return new Date(thread.updated_at * 1000).toISOString();
  }

  return new Date().toISOString();
}

function sortThreadsForRepair(threads: ThreadRow[]): ThreadRow[] {
  return threads.slice().sort((left, right) => {
    const rightTime = sortableThreadTime(right);
    const leftTime = sortableThreadTime(left);
    return rightTime - leftTime || left.id.localeCompare(right.id);
  });
}

function sortableThreadTime(thread: ThreadRow): number {
  if (typeof thread.updated_at_ms === "number" && Number.isFinite(thread.updated_at_ms)) {
    return thread.updated_at_ms;
  }

  if (typeof thread.updated_at === "number" && Number.isFinite(thread.updated_at)) {
    return thread.updated_at * 1000;
  }

  if (typeof thread.created_at_ms === "number" && Number.isFinite(thread.created_at_ms)) {
    return thread.created_at_ms;
  }

  if (typeof thread.created_at === "number" && Number.isFinite(thread.created_at)) {
    return thread.created_at * 1000;
  }

  return 0;
}

function unusableColumnSql(column: "title" | "preview"): string {
  return `(${column} IS NULL OR trim(${column}) = '' OR lower(trim(${column})) LIKE '<environment_context>%' OR lower(trim(${column})) LIKE '&lt;environment_context&gt;%' OR lower(trim(${column})) LIKE '<permissions instructions>%' OR lower(trim(${column})) LIKE '&lt;permissions instructions&gt;%')`;
}
