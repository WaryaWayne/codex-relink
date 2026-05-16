import { checkbox, confirm, Separator } from "@inquirer/prompts";

import { applySelectedRepairActions, createRepairPlan, formatRepairResult } from "./repair.js";
import type { RepairResult } from "./repair.js";
import type { LoadedCodexData, RepairAction, RepairPlan } from "./types.js";

type RepairChoiceValue = string;

export type InteractiveRepairOptions = {
  project?: string;
};

export type InteractiveRepairChoice = {
  value: RepairChoiceValue;
  name: string;
  short: string;
  description: string;
  checked: boolean;
};

export type InteractiveRepairChoiceGroup = {
  choices: Array<Separator | InteractiveRepairChoice>;
  actionByValue: Map<RepairChoiceValue, RepairAction>;
};

const RECOMMENDED_ACTION_TYPES = new Set<RepairAction["type"]>([
  "fill-generic-preview",
  "fill-generic-title",
  "fill-preview",
  "fill-title",
  "add-session-index-entry"
]);
const OPTIONAL_ACTION_TYPES = new Set<RepairAction["type"]>(["set-workspace-root-hint", "remap-cwd"]);

export async function runInteractiveRepair(data: LoadedCodexData, options: InteractiveRepairOptions): Promise<RepairResult | null> {
  assertInteractiveTty();

  const candidatePlan = createInteractiveRepairPlan(data, options);
  const choiceGroup = createInteractiveRepairChoices(candidatePlan);
  const actionableChoices = choiceGroup.choices.filter((choice): choice is InteractiveRepairChoice => !Separator.isSeparator(choice));

  if (actionableChoices.length === 0) {
    console.log("No repair actions found.");
    return null;
  }

  console.log("Use the checkbox multi-select. Space to select, enter to continue.");

  const selectedValues = await checkbox({
    message: "Select repairs to apply",
    choices: choiceGroup.choices,
    pageSize: 14
  });

  const selectedActions = getSelectedRepairActions(selectedValues, choiceGroup.actionByValue);

  if (selectedActions.length === 0) {
    console.log("No repairs selected. Nothing was changed.");
    return null;
  }

  console.log(formatSelectedRepairSummary(selectedActions));

  const shouldApply = await confirm({
    message: "Apply selected repairs now? A backup will be created first.",
    default: false
  });

  if (!shouldApply) {
    console.log("Repair cancelled. Nothing was changed.");
    return null;
  }

  const result = await applySelectedRepairActions(data, selectedActions);
  process.stdout.write(formatRepairResult(result));
  return result;
}

export function createInteractiveRepairPlan(data: LoadedCodexData, options: InteractiveRepairOptions = {}): RepairPlan {
  const plan = createRepairPlan(data, { project: options.project });
  return {
    actions: [...plan.actions, ...plan.unappliedOptionalActions],
    unappliedOptionalActions: []
  };
}

export function createInteractiveRepairChoices(plan: RepairPlan): InteractiveRepairChoiceGroup {
  const recommendedActions = plan.actions.filter((action) => RECOMMENDED_ACTION_TYPES.has(action.type));
  const optionalActions = plan.actions.filter((action) => OPTIONAL_ACTION_TYPES.has(action.type));
  const choices: Array<Separator | InteractiveRepairChoice> = [];
  const actionByValue = new Map<RepairChoiceValue, RepairAction>();

  addChoiceGroup(choices, actionByValue, "Recommended repairs", recommendedActions, true);
  addChoiceGroup(choices, actionByValue, "Optional project-link repairs", optionalActions, false);

  return { choices, actionByValue };
}

export function formatRepairChoiceName(action: RepairAction): string {
  const threadId = shortThreadId(action.threadId);

  if (action.type === "fill-preview") {
    return `${action.type} ${threadId} preview: ${truncateInline(action.value, 72)}`;
  }

  if (action.type === "fill-title") {
    return `${action.type} ${threadId} title: ${truncateInline(action.value, 72)}`;
  }

  if (action.type === "fill-generic-preview") {
    return `${action.type} ${threadId} preview: ${truncateInline(action.value, 72)}`;
  }

  if (action.type === "fill-generic-title") {
    return `${action.type} ${threadId} title: ${truncateInline(action.value, 72)}`;
  }

  if (action.type === "set-workspace-root-hint") {
    return `${action.type} ${threadId} root: ${shortPath(action.value)}`;
  }

  if (action.type === "remap-cwd") {
    return `${action.type} ${threadId} cwd: ${shortPath(action.from)} -> ${shortPath(action.to)}`;
  }

  return `${action.type} ${threadId} name: ${truncateInline(action.threadName, 72)}`;
}

export function formatRepairChoiceDescription(action: RepairAction): string {
  if (action.type === "fill-preview") {
    return `Fill blank preview for ${action.threadId} from ${action.source}: ${action.value}`;
  }

  if (action.type === "fill-title") {
    return `Fill blank title for ${action.threadId} from recovered preview: ${action.value}`;
  }

  if (action.type === "fill-generic-preview") {
    return `Set blank/synthetic preview for ${action.threadId} to "${action.value}"`;
  }

  if (action.type === "fill-generic-title") {
    return `Set blank/synthetic title for ${action.threadId} to "${action.value}"`;
  }

  if (action.type === "set-workspace-root-hint") {
    return `Set thread-workspace-root-hints[${action.threadId}] to ${action.value}`;
  }

  if (action.type === "remap-cwd") {
    return `Change cwd for ${action.threadId} from ${action.from} to ${action.to}`;
  }

  return `Add ${action.threadId} to session_index.jsonl as "${action.threadName}"`;
}

export function getSelectedRepairActions(
  selectedValues: readonly RepairChoiceValue[],
  actionByValue: ReadonlyMap<RepairChoiceValue, RepairAction>
): RepairAction[] {
  return selectedValues.map((value) => actionByValue.get(value)).filter((action): action is RepairAction => action != null);
}

export function formatSelectedRepairSummary(actions: readonly RepairAction[]): string {
  const counts = actions.reduce<Record<string, number>>((acc, action) => {
    acc[action.type] = (acc[action.type] ?? 0) + 1;
    return acc;
  }, {});
  const lines = ["Selected repairs:"];

  for (const [type, count] of Object.entries(counts)) {
    lines.push(`- ${type}: ${count}`);
  }

  return `${lines.join("\n")}\n`;
}

export function isPromptExit(error: unknown): boolean {
  return error instanceof Error && ["AbortPromptError", "CancelPromptError", "ExitPromptError"].includes(error.name);
}

function addChoiceGroup(
  choices: Array<Separator | InteractiveRepairChoice>,
  actionByValue: Map<RepairChoiceValue, RepairAction>,
  label: string,
  actions: RepairAction[],
  checked: boolean
): void {
  if (actions.length === 0) {
    return;
  }

  choices.push(new Separator(label));

  actions.forEach((action, index) => {
    const value = `${action.type}:${action.threadId}:${index}`;
    actionByValue.set(value, action);
    choices.push({
      value,
      name: formatRepairChoiceName(action),
      short: `${action.type} ${shortThreadId(action.threadId)}`,
      description: formatRepairChoiceDescription(action),
      checked
    });
  });
}

function assertInteractiveTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("repair --interactive requires an interactive TTY for stdin and stdout.");
  }
}

function shortThreadId(threadId: string): string {
  return threadId.length <= 8 ? threadId : threadId.slice(0, 8);
}

function truncateInline(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return value;
  }

  return `.../${parts.slice(-2).join("/")}`;
}
