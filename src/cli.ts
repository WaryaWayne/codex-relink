#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  findResumeCandidates,
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
    const data = yield* loadCodexData({ codexHome: options.codexHome });
    const candidates = findResumeCandidates(data, cwd);

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
