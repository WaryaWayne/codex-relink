import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyRepairPlan, createRepairPlan } from "./repair.js";
import type { LoadedCodexData, ThreadRow } from "./types.js";

describe("repair planning and writing", () => {
  it("plans dry-run preview repairs without writing", () => {
    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        preview: "",
        first_user_message: "repair this"
      })
    ]);

    const plan = createRepairPlan(data);

    expect(plan.actions).toContainEqual({
      type: "fill-preview",
      threadId: "thread-1",
      value: "repair this",
      source: "first_user_message"
    });
  });

  it("applies write-mode preview repairs to sqlite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-repair-"));
    const dbPath = path.join(dir, "state_5.sqlite");
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      cwd TEXT,
      title TEXT,
      preview TEXT,
      first_user_message TEXT,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      archived INTEGER
    )`);
    db.prepare("INSERT INTO threads (id, preview, first_user_message, archived) VALUES (?, ?, ?, ?)").run(
      "thread-1",
      "",
      "repair this",
      0
    );
    db.close();

    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        preview: "",
        first_user_message: "repair this"
      })
    ]);
    data.paths.stateDbPath = dbPath;

    const plan = createRepairPlan(data);
    applyRepairPlan(data, plan, {});

    const verifyDb = new Database(dbPath, { readonly: true });
    expect(verifyDb.prepare("SELECT preview FROM threads WHERE id = ?").get("thread-1")).toEqual({
      preview: "repair this"
    });
    verifyDb.close();
  });
});

function makeLoadedData(threads: ThreadRow[]): LoadedCodexData {
  return {
    paths: {
      codexHome: "/tmp/codex",
      stateDbPath: "/tmp/codex/state_5.sqlite",
      globalStatePath: "/tmp/codex/.codex-global-state.json",
      sessionsDir: "/tmp/codex/sessions"
    },
    threads,
    globalState: {},
    savedProjectRoots: [],
    transcripts: [],
    transcriptsByThreadId: new Map(),
    transcriptIds: new Set()
  };
}

function makeThread(overrides: Partial<ThreadRow>): ThreadRow {
  return {
    id: "thread-1",
    rollout_path: null,
    created_at: null,
    updated_at: null,
    cwd: null,
    title: null,
    preview: null,
    first_user_message: null,
    git_sha: null,
    git_branch: null,
    git_origin_url: null,
    archived: 0,
    ...overrides
  };
}
