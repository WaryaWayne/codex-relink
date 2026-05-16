#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Fiber } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  findResumeCandidates,
  formatCliHeader,
  formatNoChatsFound,
  formatReadingLine,
  formatSelectedResumeResult,
  getLatestResumeCandidate,
  formatUnknownSubcommandError,
  selectResumeCandidate,
} from "./resume.js";
import { loadCodexData } from "./storage.js";

const VERSION = "0.0.1";
const KNOWN_SUBCOMMANDS = new Set(["latest", "list"]);
const ACTION_FLAGS = new Set(["--help", "-h", "--version", "--completions"]);
const FLAGS_WITH_VALUE = new Set(["--codex-home", "--log-level", "--completions"]);
const STATUS_LINE_INDENT = "  ";

const currentWorkingDirectory = Effect.sync(() => process.cwd());

const codexHome = Flag.string("codex-home").pipe(
  Flag.withDescription("Codex home directory. Defaults to ~/.codex."),
  Flag.withDefault("~/.codex"),
);

const root = Command.make("codex-relink").pipe(
  Command.withSharedFlags({ codexHome }),
  Command.withDescription(
    "Find Codex chats for the current directory and print resume commands.",
  ),
);

const latest = Command.make(
  "latest",
  {},
  Effect.fn("Cli.latest")(function* () {
    const options = yield* root;
    const cwd = yield* currentWorkingDirectory;
    const candidates = yield* loadResumeCandidates(options.codexHome, cwd);
    const candidate = getLatestResumeCandidate(candidates);

    if (!candidate) {
      yield* Console.log(formatNoChatsFound(cwd));
      return;
    }

    yield* Console.log(formatSelectedResumeResult(candidate.resumeCommand));
  }),
).pipe(
  Command.withDescription(
    "Print the newest Codex resume command for the current directory.",
  ),
);

const list = Command.make(
  "list",
  {},
  Effect.fn("Cli.list")(function* () {
    const options = yield* root;
    const cwd = yield* currentWorkingDirectory;
    const candidates = yield* loadResumeCandidates(options.codexHome, cwd);

    if (candidates.length === 0) {
      yield* Console.log(formatNoChatsFound(cwd));
      return;
    }

    const selected = yield* selectResumeCandidate(candidates);
    yield* Console.log(formatSelectedResumeResult(selected.resumeCommand));
  }),
).pipe(
  Command.withDescription(
    "Pick a Codex chat for the current directory and print its resume command.",
  ),
);

const app = root.pipe(Command.withSubcommands([latest, list]));

const runCommand = Command.run(app, { version: VERSION });

const main = Effect.gen(function* () {
  const unknownSubcommand = getUnknownSubcommand(process.argv.slice(2));
  if (unknownSubcommand !== null) {
    yield* Console.error(formatCliHeader({ color: stderrSupportsColor() }));
    yield* Console.error(formatUnknownSubcommandError(unknownSubcommand));
    yield* setExitCode(1);
    return;
  }

  yield* runCommand;
}).pipe(
  Effect.catchTag("ShowHelp", (error) =>
    error.errors.length === 0 ? Effect.void : setExitCode(1),
  ),
  Effect.onInterrupt(() =>
    Console.error("Interactive selection cancelled.").pipe(
      Effect.andThen(setExitCode(130)),
    ),
  ),
  Effect.catch((error: unknown) => Console.error(formatError(error)).pipe(Effect.andThen(setExitCode(1)))),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(main);

function loadResumeCandidates(codexHome: string, cwd: string) {
  return Effect.gen(function* () {
    yield* Console.error(formatCliHeader({ codexHome, color: stderrSupportsColor() }));
    const readingLine = formatReadingLine(codexHome, cwd);
    const data = yield* withStderrSpinner(readingLine, loadCodexData({ codexHome }));
    return findResumeCandidates(data, cwd);
  });
}

function stderrSupportsColor(): boolean {
  if (process.stderr.isTTY !== true) {
    return false;
  }

  if (typeof process.stderr.hasColors === "function") {
    return process.stderr.hasColors();
  }

  return true;
}

function withStderrSpinner<A, E, R>(
  message: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    startStderrSpinner(message),
    () => effect,
    stopStderrSpinner,
  ).pipe(Effect.tap(() => Console.error(formatCompletedStatusLine(message))));
}

function startStderrSpinner(message: string): Effect.Effect<Fiber.Fiber<never> | null> {
  return Effect.gen(function* () {
    if (process.stderr.isTTY !== true) {
      return null;
    }

    const fiber = yield* makeStderrSpinner(message).pipe(
      Effect.forkChild({ startImmediately: true }),
    );

    return fiber;
  });
}

function stopStderrSpinner(fiber: Fiber.Fiber<never> | null): Effect.Effect<void> {
  if (fiber === null) {
    return Effect.void;
  }

  return Fiber.interrupt(fiber).pipe(Effect.andThen(clearStderrSpinner));
}

function makeStderrSpinner(message: string): Effect.Effect<never> {
  const frames = ["◐", "◓", "◑", "◒"] as const;
  let frameIndex = 0;

  return Effect.gen(function* () {
    yield* Effect.sync(() => {
      const frame = frames[frameIndex % frames.length];
      frameIndex += 1;
      process.stderr.write(`\r${formatSpinnerStatusLine(frame, message)}`);
    });
    yield* Effect.sleep("90 millis");
  }).pipe(Effect.forever);
}

function formatSpinnerStatusLine(frame: string, message: string): string {
  return `${STATUS_LINE_INDENT}${frame} ${message}`;
}

function formatCompletedStatusLine(message: string): string {
  return `${STATUS_LINE_INDENT}${message}`;
}

const clearStderrSpinner = Effect.sync(() => {
  if (process.stderr.isTTY === true) {
    process.stderr.write("\r\x1B[2K");
  }
});

function getUnknownSubcommand(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      return null;
    }

    if (ACTION_FLAGS.has(arg) || arg.startsWith("--completions=")) {
      return null;
    }

    if (FLAGS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith("--codex-home=") || arg.startsWith("--log-level=")) {
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    return KNOWN_SUBCOMMANDS.has(arg) ? null : arg;
  }

  return null;
}

function setExitCode(code: number) {
  return Effect.sync(() => {
    process.exitCode = code;
  });
}

function formatError(error: unknown): string {
  const message = formatErrorMessage(error);
  return message.startsWith("Error:") ? message : `Error: ${message}`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error != null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}
