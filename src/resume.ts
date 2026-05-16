import { select } from "@inquirer/prompts";

import { hasUsableDisplayPreview, hasUsableDisplayTitle, normalizeTitle } from "./preview.js";
import { filterThreadsForProject } from "./project.js";
import type { LoadedCodexData, ThreadRow, TranscriptMetadata } from "./types.js";

export type ResumeCandidate = {
  id: string;
  thread: ThreadRow;
  title: string;
  shortId: string;
  updatedLabel: string;
  resumeCommand: string;
  sortTime: number;
};

export type ResumeChoice = {
  value: string;
  name: string;
  short: string;
  description: string;
};

export type ResumeChoiceOptions = {
  terminalColumns?: number;
};

export type ResumePromptConfig = {
  message: string;
  choices: ResumeChoice[];
  pageSize: number;
  loop: false;
};

const DEFAULT_RESUME_PICKER_PAGE_SIZE = 12;
const DEFAULT_TERMINAL_COLUMNS = 80;
const INQUIRER_ROW_PREFIX_COLUMNS = 2;
const UPDATED_LABEL_COLUMNS = 20;
const SHORT_ID_COLUMNS = 8;

export function findResumeCandidates(data: LoadedCodexData, cwd: string): ResumeCandidate[] {
  return filterThreadsForProject(data, cwd)
    .map((thread) => toResumeCandidate(thread, data.transcriptsByThreadId.get(thread.id)))
    .sort(compareResumeCandidatesNewestFirst);
}

export function getLatestResumeCandidate(candidates: readonly ResumeCandidate[]): ResumeCandidate | null {
  return candidates[0] ?? null;
}

export function createResumeChoices(candidates: readonly ResumeCandidate[], options: ResumeChoiceOptions = {}): ResumeChoice[] {
  const numberWidth = Math.max(1, String(candidates.length).length);

  return candidates.map((candidate, index) => ({
    value: candidate.id,
    name: formatResumeChoiceName(candidate, index + 1, {
      numberWidth,
      terminalColumns: options.terminalColumns
    }),
    short: candidate.shortId,
    description: `${candidate.resumeCommand} (${candidate.id})`
  }));
}

export function createResumePromptConfig(candidates: readonly ResumeCandidate[], options: ResumeChoiceOptions = {}): ResumePromptConfig {
  return {
    message: "Select Codex chat",
    choices: createResumeChoices(candidates, options),
    pageSize: Math.max(1, Math.min(DEFAULT_RESUME_PICKER_PAGE_SIZE, candidates.length)),
    loop: false
  };
}

export async function selectResumeCandidate(candidates: readonly ResumeCandidate[]): Promise<ResumeCandidate> {
  assertInteractiveTty();

  const selectedId = await select(createResumePromptConfig(candidates, { terminalColumns: process.stdout.columns }));

  const selected = candidates.find((candidate) => candidate.id === selectedId);
  if (!selected) {
    throw new Error(`Selected Codex chat was not found: ${selectedId}`);
  }

  return selected;
}

export function formatResumeCommand(threadId: string): string {
  return `codex resume ${threadId}`;
}

export function formatNoChatsFound(cwd: string): string {
  return `No Codex chats were found for the current directory: ${cwd}`;
}

export function resolveResumeTitle(thread: ThreadRow, transcript?: TranscriptMetadata | null): string {
  if (hasUsableDisplayTitle(thread.title)) {
    return normalizeTitle(thread.title ?? "");
  }

  if (hasUsableDisplayPreview(thread.preview)) {
    return normalizeTitle(thread.preview ?? "");
  }

  const firstUserMessage = transcript?.userMessages.find((message) => hasUsableDisplayPreview(message));
  if (firstUserMessage) {
    return normalizeTitle(firstUserMessage);
  }

  return "Untitled Codex chat";
}

export function formatResumeChoiceName(
  candidate: ResumeCandidate,
  position = 1,
  options: ResumeChoiceOptions & { numberWidth?: number } = {}
): string {
  const numberWidth = options.numberWidth ?? String(position).length;
  const numberLabel = `${String(position).padStart(numberWidth)}.`;
  const prefix = [
    numberLabel,
    candidate.updatedLabel.padEnd(UPDATED_LABEL_COLUMNS),
    candidate.shortId.padEnd(SHORT_ID_COLUMNS)
  ].join("  ");
  const terminalColumns = Math.max(1, options.terminalColumns ?? DEFAULT_TERMINAL_COLUMNS);
  const maxTitleLength = Math.max(0, terminalColumns - INQUIRER_ROW_PREFIX_COLUMNS - prefix.length - 2);

  return `${prefix}  ${truncateInline(candidate.title, maxTitleLength)}`.trimEnd();
}

export function getThreadResumeTime(thread: ThreadRow): number {
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

export function formatUpdatedTime(thread: ThreadRow): string {
  const time = getThreadResumeTime(thread);
  if (time <= 0) {
    return "unknown time";
  }

  const iso = new Date(time).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function isPromptExit(error: unknown): boolean {
  return error instanceof Error && ["AbortPromptError", "CancelPromptError", "ExitPromptError"].includes(error.name);
}

function toResumeCandidate(thread: ThreadRow, transcript?: TranscriptMetadata): ResumeCandidate {
  return {
    id: thread.id,
    thread,
    title: resolveResumeTitle(thread, transcript),
    shortId: shortThreadId(thread.id),
    updatedLabel: formatUpdatedTime(thread),
    resumeCommand: formatResumeCommand(thread.id),
    sortTime: getThreadResumeTime(thread)
  };
}

function compareResumeCandidatesNewestFirst(left: ResumeCandidate, right: ResumeCandidate): number {
  return right.sortTime - left.sortTime || right.id.localeCompare(left.id);
}

function shortThreadId(threadId: string): string {
  return threadId.length <= 8 ? threadId : threadId.slice(0, 8);
}

function truncateInline(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (maxLength <= 0) {
    return "";
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }

  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

function assertInteractiveTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("codex-relink list requires an interactive TTY for stdin and stdout.");
  }
}
