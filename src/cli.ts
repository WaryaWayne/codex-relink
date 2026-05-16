#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Fiber } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  findResumeCandidates,
  formatListHeader,
  formatListMatchCheckpoint,
  formatListReadingLine,
  formatNoChatsFound,
  getLatestResumeCandidate,
  selectResumeCandidate,
} from "./resume.js";
import { loadCodexData } from "./storage.js";

const VERSION = "0.0.1";

const currentWorkingDirectory = Effect.sync(() => process.cwd());

const codexHome = Flag.string("codex-home").pipe(
  Flag.withDescription("Codex home directory"),
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
    const data = yield* loadCodexData({ codexHome: options.codexHome });
    const candidate = getLatestResumeCandidate(findResumeCandidates(data, cwd));

    if (!candidate) {
      yield* Console.log(formatNoChatsFound(cwd));
      return;
    }

    yield* Console.log(candidate.resumeCommand);
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
    yield* Console.error(formatListHeader({ color: process.stderr.isTTY === true }));
    const readingLine = formatListReadingLine(options.codexHome, cwd);
    const data = yield* withStderrSpinner(readingLine, loadCodexData({ codexHome: options.codexHome }));
    const candidates = findResumeCandidates(data, cwd);
    yield* Console.error(formatListMatchCheckpoint(candidates.length));

    if (candidates.length === 0) {
      yield* Console.log(formatNoChatsFound(cwd));
      return;
    }

    const selected = yield* selectResumeCandidate(candidates);
    yield* Console.log(selected.resumeCommand);
  }),
).pipe(
  Command.withDescription(
    "Pick a Codex chat for the current directory and print its resume command.",
  ),
);

const app = root.pipe(Command.withSubcommands([latest, list]));

const main = Command.run(app, { version: VERSION }).pipe(
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

function withStderrSpinner<A, E, R>(
  message: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    startStderrSpinner(message),
    () => effect,
    stopStderrSpinner,
  ).pipe(Effect.tap(() => Console.error(message)));
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
      process.stderr.write(`\r${frame} ${message}`);
    });
    yield* Effect.sleep("90 millis");
  }).pipe(Effect.forever);
}

const clearStderrSpinner = Effect.sync(() => {
  if (process.stderr.isTTY === true) {
    process.stderr.write("\r\x1B[2K");
  }
});

function setExitCode(code: number) {
  return Effect.sync(() => {
    process.exitCode = code;
  });
}

function formatError(error: unknown): string {
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
