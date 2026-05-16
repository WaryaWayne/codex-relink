import { hasUsableDisplayPreview, hasUsableDisplayTitle, isBlank } from "./preview.js";
import type { ThreadRow } from "./types.js";

export type RepairCandidateEvidence = {
  hasThreadGoal?: boolean;
};

export function isDefaultRepairCandidate(thread: ThreadRow, evidence: RepairCandidateEvidence = {}): boolean {
  if (thread.archived === 1) {
    return false;
  }

  const source = normalizeSource(thread.source);
  if (source !== "cli" && source !== "vscode") {
    return false;
  }

  const threadSource = normalizeSource(thread.thread_source);
  if (threadSource !== "" && threadSource !== "user") {
    return false;
  }

  return hasRecoverabilityEvidence(thread, evidence);
}

export function isGuardianOrSubagentThread(thread: ThreadRow): boolean {
  const source = normalizeSource(thread.source);
  const threadSource = normalizeSource(thread.thread_source);

  return (
    threadSource === "subagent" ||
    threadSource === "guardian" ||
    source.includes("subagent") ||
    source.includes("guardian")
  );
}

function hasRecoverabilityEvidence(thread: ThreadRow, evidence: RepairCandidateEvidence): boolean {
  return (
    evidence.hasThreadGoal === true ||
    thread.has_user_event === 1 ||
    !isBlank(thread.rollout_path) ||
    hasUsableDisplayTitle(thread.title) ||
    hasUsableDisplayPreview(thread.preview) ||
    !isBlank(thread.first_user_message)
  );
}

function normalizeSource(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
