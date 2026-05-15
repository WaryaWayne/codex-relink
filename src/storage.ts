import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import fg from "fast-glob";

import { parseJsonlTranscript } from "./jsonl.js";
import { getCodexPaths, safeTimestamp } from "./paths.js";
import type { GlobalState, LoadedCodexData, ThreadRow } from "./types.js";

export type LoadOptions = {
  codexHome?: string;
  includeTranscripts?: boolean;
};

export async function loadCodexData(options: LoadOptions = {}): Promise<LoadedCodexData> {
  const paths = getCodexPaths(options.codexHome);
  const threads = readThreads(paths.stateDbPath);
  const globalState = readGlobalState(paths.globalStatePath);
  const savedProjectRoots = getSavedProjectRoots(globalState);
  const transcripts = options.includeTranscripts === false ? [] : await readTranscripts(paths.codexHome);
  const transcriptsByThreadId = new Map<string, ReturnType<typeof parseJsonlTranscript>>();
  const transcriptIds = new Set<string>();

  for (const transcript of transcripts) {
    if (transcript.threadId) {
      transcriptIds.add(transcript.threadId);
      transcriptsByThreadId.set(transcript.threadId, transcript);
    }
  }

  return {
    paths,
    threads,
    globalState,
    savedProjectRoots,
    transcripts,
    transcriptsByThreadId,
    transcriptIds
  };
}

export function readThreads(stateDbPath: string): ThreadRow[] {
  if (!fs.existsSync(stateDbPath)) {
    throw new Error(`Codex SQLite database not found: ${stateDbPath}`);
  }

  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `SELECT id, rollout_path, created_at, updated_at, cwd, title, preview, first_user_message,
                git_sha, git_branch, git_origin_url, archived
           FROM threads`
      )
      .all() as ThreadRow[];
  } finally {
    db.close();
  }
}

export function readGlobalState(globalStatePath: string): GlobalState {
  if (!fs.existsSync(globalStatePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(globalStatePath, "utf8")) as GlobalState;
}

export async function readTranscripts(codexHome: string): Promise<ReturnType<typeof parseJsonlTranscript>[]> {
  const entries = await fg("sessions/**/*.jsonl", {
    cwd: codexHome,
    absolute: true,
    onlyFiles: true
  });

  return entries.map((entry) => parseJsonlTranscript(entry));
}

export function getSavedProjectRoots(globalState: GlobalState): string[] {
  const roots = new Set<string>();
  addStringArray(globalState["electron-saved-workspace-roots"], roots);
  addStringArray(globalState["project-order"], roots);
  addObjectKeys(globalState["electron-workspace-root-labels"], roots);

  return Array.from(roots).filter((root) => path.isAbsolute(root));
}

export function getProjectlessThreadIds(globalState: GlobalState): Set<string> {
  const ids = new Set<string>();
  addStringArray(globalState["projectless-thread-ids"], ids);
  return ids;
}

export function getThreadWorkspaceRootHints(globalState: GlobalState): Record<string, string> {
  const hints = globalState["thread-workspace-root-hints"];
  if (!isRecord(hints)) {
    return {};
  }

  return Object.fromEntries(Object.entries(hints).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function createBackups(codexHome: string, stateDbPath: string, globalStatePath: string): Promise<string> {
  const backupDir = path.join(codexHome, "backups", `codex-relink-${safeTimestamp()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(path.join(backupDir, "state_5.sqlite"));
  } finally {
    db.close();
  }

  for (const suffix of ["-wal", "-shm"]) {
    const source = `${stateDbPath}${suffix}`;
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(backupDir, `state_5.sqlite${suffix}`));
    }
  }

  if (fs.existsSync(globalStatePath)) {
    fs.copyFileSync(globalStatePath, path.join(backupDir, ".codex-global-state.json"));
  }

  return backupDir;
}

function addStringArray(value: unknown, output: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") {
      output.add(item);
    }
  }
}

function addObjectKeys(value: unknown, output: Set<string>): void {
  if (!isRecord(value)) {
    return;
  }

  for (const key of Object.keys(value)) {
    if (key.trim() !== "") {
      output.add(key);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
