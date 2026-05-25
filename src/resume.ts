import { Console, Data, DateTime, Effect, Terminal } from "effect";
import { Prompt } from "effect/unstable/cli";

import {
  hasUsableDisplayPreview,
  hasUsableDisplayTitle,
  normalizeTitle,
} from "./preview.js";
import { filterThreadsForProject } from "./project.js";
import type {
  LoadedCodexData,
  ThreadRow,
  TranscriptMetadata,
} from "./types.js";

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
  title: string;
  description?: string;
};

export type ResumeChoiceOptions = {
  terminalColumns?: number;
};

export type ResumeCandidateOptions = {
  timeZone?: string;
};

export type ResumePromptConfig = {
  message: string;
  choices: ResumeChoice[];
  maxPerPage: number;
};

const DEFAULT_RESUME_PICKER_PAGE_SIZE = 12;
const DEFAULT_TERMINAL_COLUMNS = 80;
const PROMPT_ROW_PREFIX_COLUMNS = 2;
const UPDATED_LABEL_COLUMNS = 20;
const SHORT_ID_COLUMNS = 8;
const ANSI_CURSOR_HIDE = "\x1B[?25l";
const ANSI_CURSOR_UP_ONE = "\x1B[1A";
const ANSI_ERASE_LINE = "\x1B[2K";
const ANSI_CURSOR_LINE_START = "\r";
const ANSI_BOLD = "\x1B[1m";
const ANSI_CYAN_BRIGHT = "\x1B[96m";
const ANSI_GREEN_BRIGHT = "\x1B[92m";
const ANSI_RESET = "\x1B[0m";
const CLI_HEADER_INDENT = "  ";
const CLI_BLOCK_INDENT = "  ";
const SOCIAL_HANDLE = "@waryawayne";
const CLI_BOTTOM_PADDING = [""];
const PROMPT_LEADING_SYMBOL = "?";
const PROMPT_SUBMITTED_SYMBOL = "✔";
const PROMPT_TRAILING_SYMBOL = "›";
const PROMPT_SELECTED_CHOICE_PREFIX = "❯ ";
const PROMPT_CHOICE_PREFIX = "  ";
const CLI_ASCII_ICON = [
  [" ████", "████ "].join(" "),
  ["█    ", "█   █"].join(" "),
  ["█    ", "████ "].join(" "),
  ["█    ", "█  █ "].join(" "),
  [" ████", "█   █"].join(" "),
].join("\n");
const PromptAction = Data.taggedEnum<Prompt.ActionDefinition>();

export class NonInteractiveTerminal extends Data.TaggedError(
  "NonInteractiveTerminal",
)<{}> {
  override get message(): string {
    return "codex-relink list requires an interactive TTY for stdin and stdout.";
  }
}

export function findResumeCandidates(
  data: LoadedCodexData,
  cwd: string,
  options: ResumeCandidateOptions = {},
): ResumeCandidate[] {
  return filterThreadsForProject(data, cwd)
    .map((thread) =>
      toResumeCandidate(
        thread,
        data.transcriptsByThreadId.get(thread.id),
        options,
      ),
    )
    .sort(compareResumeCandidatesNewestFirst);
}

export function getLatestResumeCandidate(
  candidates: readonly ResumeCandidate[],
): ResumeCandidate | null {
  return candidates[0] ?? null;
}

export function createResumeChoices(
  candidates: readonly ResumeCandidate[],
  options: ResumeChoiceOptions = {},
): ResumeChoice[] {
  const numberWidth = Math.max(1, String(candidates.length).length);

  return candidates.map((candidate, index) => ({
    value: candidate.id,
    title: formatResumeChoiceName(candidate, index + 1, {
      numberWidth,
      terminalColumns: options.terminalColumns,
    }),
  }));
}

export function createResumePromptConfig(
  candidates: readonly ResumeCandidate[],
  options: ResumeChoiceOptions = {},
): ResumePromptConfig {
  return {
    message: `${CLI_BLOCK_INDENT}Select Codex chat`,
    choices: createResumeChoices(candidates, options),
    maxPerPage: Math.max(
      1,
      Math.min(DEFAULT_RESUME_PICKER_PAGE_SIZE, candidates.length),
    ),
  };
}

export const selectResumeCandidate = Effect.fn("Resume.selectResumeCandidate")(
  function* (candidates: readonly ResumeCandidate[]) {
    yield* assertInteractiveTty;

    const terminal = yield* Terminal.Terminal;
    const terminalColumns = yield* terminal.columns;
    yield* Console.log("");
    const selected = yield* Prompt.run(
      createResumeSelectPrompt(candidates, { terminalColumns }),
    );

    return selected;
  },
);

export function formatResumeCommand(threadId: string): string {
  return `codex resume ${threadId}`;
}

export function formatSelectedResumeResult(resumeCommand: string): string {
  return formatCliOutputBlock([
    "Copy the command below to resume your chat:",
    "",
    resumeCommand,
  ]);
}

export function formatNoChatsFound(cwd: string): string {
  return formatCliOutputBlock([
    `No Codex chats were found for the current directory: ${cwd}`,
  ]);
}

export function formatCliHeader(
  options: { codexHome?: string; color?: boolean } = {},
): string {
  const name = "codex-relink";
  const findLine = "Find Codex chats for this project.";

  if (options.color === true) {
    return [
      "",
      indentHeaderBlock(CLI_ASCII_ICON),
      "",
      `${CLI_HEADER_INDENT}${ANSI_BOLD}${ANSI_GREEN_BRIGHT}${name}${ANSI_RESET}`,
      `${CLI_HEADER_INDENT}${ANSI_CYAN_BRIGHT}Find${ANSI_RESET} Codex chats for this project.`,
      `${CLI_HEADER_INDENT}by ${SOCIAL_HANDLE}`,
    ].join("\n");
  }

  return [
    "",
    indentHeaderBlock(CLI_ASCII_ICON),
    "",
    `${CLI_HEADER_INDENT}${name}`,
    `${CLI_HEADER_INDENT}${findLine}`,
    `${CLI_HEADER_INDENT}by ${SOCIAL_HANDLE}`,
  ].join("\n");
}

function indentHeaderBlock(value: string): string {
  return value.split("\n").map((line) => `${CLI_HEADER_INDENT}${line}`).join("\n");
}

export function formatReadingLine(codexHome: string, cwd: string): string {
  return `Reading Codex chats from ${codexHome} for ${cwd}.`;
}

export function formatUnknownSubcommandError(subcommand: string): string {
  return formatCliOutputBlock([
    `Error: unknown subcommand "${subcommand}" for "codex-relink".`,
    `Use "codex-relink --help" to see available commands: latest, list.`,
  ]);
}

function formatCliOutputBlock(lines: readonly string[]): string {
  return [
    "",
    ...lines.map(formatCliOutputLine),
    ...CLI_BOTTOM_PADDING,
  ].join("\n");
}

function formatCliOutputLine(line: string): string {
  return line === "" ? "" : `${CLI_BLOCK_INDENT}${line}`;
}

export function resolveResumeTitle(
  thread: ThreadRow,
  transcript?: TranscriptMetadata | null,
): string {
  if (hasUsableDisplayTitle(thread.title)) {
    return normalizeTitle(thread.title ?? "");
  }

  if (hasUsableDisplayPreview(thread.preview)) {
    return normalizeTitle(thread.preview ?? "");
  }

  const firstUserMessage = transcript?.userMessages.find((message) =>
    hasUsableDisplayPreview(message),
  );
  if (firstUserMessage) {
    return normalizeTitle(firstUserMessage);
  }

  return "Untitled Codex chat";
}

export function formatResumeChoiceName(
  candidate: ResumeCandidate,
  position = 1,
  options: ResumeChoiceOptions & { numberWidth?: number } = {},
): string {
  const numberWidth = options.numberWidth ?? String(position).length;
  const numberLabel = `${String(position).padStart(numberWidth)}.`;
  const prefix = [
    numberLabel,
    candidate.updatedLabel.padEnd(UPDATED_LABEL_COLUMNS),
    candidate.shortId.padEnd(SHORT_ID_COLUMNS),
  ].join("  ");
  const terminalColumns = Math.max(
    1,
    options.terminalColumns ?? DEFAULT_TERMINAL_COLUMNS,
  );
  const maxTitleLength = Math.max(
    0,
    terminalColumns -
      PROMPT_ROW_PREFIX_COLUMNS -
      CLI_BLOCK_INDENT.length -
      prefix.length -
      2,
  );

  return `${CLI_BLOCK_INDENT}${prefix}  ${truncateInline(candidate.title, maxTitleLength)}`.trimEnd();
}

export function formatSelectedResumeChoiceName(
  candidate: ResumeCandidate,
): string {
  return `${CLI_BLOCK_INDENT}${[
    candidate.shortId.padEnd(SHORT_ID_COLUMNS),
  ].join("  ")}`.trimEnd();
}

export function formatSubmittedResumePromptLine(
  candidate: ResumeCandidate,
): string {
  return `${PROMPT_SUBMITTED_SYMBOL} ${CLI_BLOCK_INDENT}Chosen ID: ${formatSelectedResumeChoiceName(candidate)}`;
}

export function getThreadResumeTime(thread: ThreadRow): number {
  if (
    typeof thread.updated_at_ms === "number" &&
    Number.isFinite(thread.updated_at_ms)
  ) {
    return thread.updated_at_ms;
  }

  if (
    typeof thread.updated_at === "number" &&
    Number.isFinite(thread.updated_at)
  ) {
    return thread.updated_at * 1000;
  }

  if (
    typeof thread.created_at_ms === "number" &&
    Number.isFinite(thread.created_at_ms)
  ) {
    return thread.created_at_ms;
  }

  if (
    typeof thread.created_at === "number" &&
    Number.isFinite(thread.created_at)
  ) {
    return thread.created_at * 1000;
  }

  return 0;
}

export function formatUpdatedTime(
  thread: ThreadRow,
  options: ResumeCandidateOptions = {},
): string {
  const time = getThreadResumeTime(thread);
  if (time <= 0) {
    return "unknown time";
  }

  return formatLocalTimestamp(time, options);
}

function toResumeCandidate(
  thread: ThreadRow,
  transcript?: TranscriptMetadata,
  options: ResumeCandidateOptions = {},
): ResumeCandidate {
  return {
    id: thread.id,
    thread,
    title: resolveResumeTitle(thread, transcript),
    shortId: shortThreadId(thread.id),
    updatedLabel: formatUpdatedTime(thread, options),
    resumeCommand: formatResumeCommand(thread.id),
    sortTime: getThreadResumeTime(thread),
  };
}

function compareResumeCandidatesNewestFirst(
  left: ResumeCandidate,
  right: ResumeCandidate,
): number {
  return right.sortTime - left.sortTime || right.id.localeCompare(left.id);
}

type ResumeSelectState = number;

function createResumeSelectPrompt(
  candidates: readonly ResumeCandidate[],
  options: ResumeChoiceOptions = {},
): Prompt.Prompt<ResumeCandidate> {
  const numberWidth = Math.max(1, String(candidates.length).length);
  const maxPerPage = Math.max(
    1,
    Math.min(DEFAULT_RESUME_PICKER_PAGE_SIZE, candidates.length),
  );
  return Prompt.custom<ResumeSelectState, ResumeCandidate>(0, {
    render: (state, action) =>
      Effect.succeed(renderResumeSelectPrompt(state, action, candidates, {
        maxPerPage,
        numberWidth,
        terminalColumns: options.terminalColumns,
      })),
    process: (input, state) =>
      processResumeSelectPromptInput(input, state, candidates),
    clear: (state) =>
      Effect.succeed(clearResumeSelectPrompt(state, candidates.length, maxPerPage)),
  });
}

function renderResumeSelectPrompt(
  state: ResumeSelectState,
  action: Prompt.Action<ResumeSelectState, ResumeCandidate>,
  candidates: readonly ResumeCandidate[],
  options: ResumeChoiceOptions & { maxPerPage: number; numberWidth: number },
): string {
  if (action._tag === "Submit") {
    return `${formatSubmittedResumePromptLine(action.value)}\n`;
  }

  if (action._tag === "Beep") {
    return "\x07";
  }

  const nextState = action.state;
  const range = getResumeSelectVisibleRange(
    nextState,
    candidates.length,
    options.maxPerPage,
  );
  const rows = candidates
    .slice(range.startIndex, range.endIndex)
    .map((candidate, offset) => {
      const index = range.startIndex + offset;
      const prefix = index === nextState
        ? PROMPT_SELECTED_CHOICE_PREFIX
        : PROMPT_CHOICE_PREFIX;
      return `${prefix}${formatResumeChoiceName(candidate, index + 1, {
        numberWidth: options.numberWidth,
        terminalColumns: options.terminalColumns,
      })}`;
    });

  return [
    `${ANSI_CURSOR_HIDE}${PROMPT_LEADING_SYMBOL} ${CLI_BLOCK_INDENT}Select Codex chat ${PROMPT_TRAILING_SYMBOL}`,
    ...rows,
  ].join("\n");
}

function processResumeSelectPromptInput(
  input: Terminal.UserInput,
  state: ResumeSelectState,
  candidates: readonly ResumeCandidate[],
): Effect.Effect<Prompt.Action<ResumeSelectState, ResumeCandidate>> {
  switch (input.key.name) {
    case "k":
    case "up": {
      return Effect.succeed(
        PromptAction.NextFrame({
          state: state === 0 ? candidates.length - 1 : state - 1,
        }),
      );
    }
    case "j":
    case "down":
    case "tab": {
      return Effect.succeed(
        PromptAction.NextFrame({
          state: state === candidates.length - 1 ? 0 : state + 1,
        }),
      );
    }
    case "enter":
    case "return": {
      const selected = candidates[state];
      return Effect.succeed(
        selected
          ? PromptAction.Submit({ value: selected })
          : PromptAction.Beep(),
      );
    }
    default: {
      return Effect.succeed(PromptAction.Beep());
    }
  }
}

function clearResumeSelectPrompt(
  state: ResumeSelectState,
  total: number,
  maxPerPage: number,
): string {
  const range = getResumeSelectVisibleRange(state, total, maxPerPage);
  return eraseTerminalLines(1 + range.endIndex - range.startIndex);
}

function getResumeSelectVisibleRange(
  state: ResumeSelectState,
  total: number,
  maxPerPage: number,
): { startIndex: number; endIndex: number } {
  const max = Math.max(1, Math.min(total, maxPerPage));
  const startIndex = Math.max(
    0,
    Math.min(total - max, state - Math.floor(max / 2)),
  );
  return {
    startIndex,
    endIndex: Math.min(total, startIndex + max),
  };
}

function eraseTerminalLines(lineCount: number): string {
  const lines = Math.max(1, lineCount);
  let output = `${ANSI_CURSOR_LINE_START}${ANSI_ERASE_LINE}`;
  for (let index = 1; index < lines; index++) {
    output += `${ANSI_CURSOR_UP_ONE}${ANSI_CURSOR_LINE_START}${ANSI_ERASE_LINE}`;
  }
  return output;
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

function formatLocalTimestamp(
  epochMillis: number,
  options: ResumeCandidateOptions,
): string {
  const date = DateTime.toDateUtc(DateTime.makeUnsafe(epochMillis));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  const parts = new Map(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const timeZoneName = parts.get("timeZoneName");
  const label = `${getDateTimePart(parts, "year")}-${getDateTimePart(parts, "month")}-${getDateTimePart(parts, "day")} ${getDateTimePart(parts, "hour")}:${getDateTimePart(parts, "minute")}`;
  return timeZoneName ? `${label} ${timeZoneName}` : label;
}

function getDateTimePart(
  parts: ReadonlyMap<string, string>,
  part: string,
): string {
  return parts.get(part) ?? "";
}

const assertInteractiveTty = Effect.sync(
  () => process.stdin.isTTY === true && process.stdout.isTTY === true,
).pipe(
  Effect.flatMap((isInteractive) =>
    isInteractive ? Effect.void : new NonInteractiveTerminal(),
  ),
);
