import os from "node:os";
import path from "node:path";

import type { CodexPaths } from "./types.js";

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function normalizeFsPath(input: string): string {
  return path.resolve(expandHome(input));
}

export function getCodexPaths(codexHomeInput = "~/.codex"): CodexPaths {
  const codexHome = normalizeFsPath(codexHomeInput);

  return {
    codexHome,
    stateDbPath: path.join(codexHome, "state_5.sqlite"),
    globalStatePath: path.join(codexHome, ".codex-global-state.json"),
    sessionIndexPath: path.join(codexHome, "session_index.jsonl"),
    sessionsDir: path.join(codexHome, "sessions")
  };
}

export function resolveMaybeRelativePath(baseDir: string, maybePath: string | null | undefined): string | null {
  if (!maybePath || maybePath.trim() === "") {
    return null;
  }

  const expanded = expandHome(maybePath);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDir, expanded);
}

export function safeTimestamp(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
