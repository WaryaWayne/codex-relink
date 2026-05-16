import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createRepairPlan, formatRepairResult, repairCodexData } from "./repair.js";
import type { LoadedCodexData, ThreadGoalRow, ThreadRow } from "./types.js";

describe("repair planning and writing", () => {
  it("plans deterministic generic titles for blank titles", () => {
    const data = makeLoadedData([
      makeThread({ id: "thread-b", title: "", preview: "" }),
      makeThread({ id: "thread-a", title: "", preview: "" })
    ]);

    const titleActions = createRepairPlan(data).actions.filter((action) => action.type === "fill-generic-title");

    expect(titleActions).toEqual([
      {
        type: "fill-generic-title",
        threadId: "thread-a",
        value: "Recovered title #1",
        source: "desktop-visibility"
      },
      {
        type: "fill-generic-title",
        threadId: "thread-b",
        value: "Recovered title #2",
        source: "desktop-visibility"
      }
    ]);
  });

  it("prefers first_user_message text for blank title and preview", () => {
    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "",
        preview: "",
        first_user_message: "Repair the creaClient Codex chat visibility bug"
      })
    ]);

    expect(createRepairPlan(data).actions).toEqual([
      {
        type: "fill-title",
        threadId: "thread-1",
        value: "Repair the creaClient Codex chat visibility bug",
        source: "preview"
      },
      {
        type: "fill-preview",
        threadId: "thread-1",
        value: "Repair the creaClient Codex chat visibility bug",
        source: "first_user_message"
      }
    ]);
  });

  it("prefers transcript user messages before generic placeholders", () => {
    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "",
        preview: "",
        first_user_message: ""
      })
    ]);
    data.transcriptsByThreadId.set("thread-1", {
      filePath: "/tmp/session.jsonl",
      threadId: "thread-1",
      cwdMentions: [],
      userMessages: ["Use transcript text for recovered display metadata"],
      eventMessages: []
    });

    expect(createRepairPlan(data).actions).toEqual([
      {
        type: "fill-title",
        threadId: "thread-1",
        value: "Use transcript text for recovered display metadata",
        source: "preview"
      },
      {
        type: "fill-preview",
        threadId: "thread-1",
        value: "Use transcript text for recovered display metadata",
        source: "transcript_user_message"
      }
    ]);
  });

  it("does not derive recovered titles from the generic preview placeholder", () => {
    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "",
        preview: "Recovered Codex conversation",
        first_user_message: ""
      })
    ]);

    expect(createRepairPlan(data).actions).toEqual([
      {
        type: "fill-generic-title",
        threadId: "thread-1",
        value: "Recovered title #1",
        source: "desktop-visibility"
      }
    ]);
  });

  it("plans generic preview for synthetic previews", () => {
    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "Good title",
        preview: "<environment_context><cwd>/repo/app</cwd></environment_context>"
      })
    ]);

    expect(createRepairPlan(data).actions).toContainEqual({
      type: "fill-generic-preview",
      threadId: "thread-1",
      value: "Recovered Codex conversation",
      source: "desktop-visibility"
    });
  });

  it("preserves existing good title and preview", () => {
    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "Good title",
        preview: "Good preview"
      })
    ]);

    expect(createRepairPlan(data).actions).toEqual([]);
  });

  it("skips subagent threads by default", () => {
    const data = makeLoadedData([
      makeThread({
        id: "subagent-1",
        source: '{"subagent":{"other":"guardian"}}',
        thread_source: "subagent",
        title: "",
        preview: ""
      })
    ]);
    data.sessionIndexIds = new Set();

    expect(createRepairPlan(data).actions).toEqual([]);
  });

  it("uses thread_goals only as recoverability evidence, not title or preview text", () => {
    const objective = "This is a very long user objective that must never be copied into display metadata.";
    const data = makeLoadedData(
      [
        makeThread({
          id: "thread-1",
          rollout_path: null,
          title: "",
          preview: "",
          first_user_message: ""
        })
      ],
      [makeThreadGoal({ thread_id: "thread-1", objective })]
    );

    const actions = createRepairPlan(data).actions;

    expect(actions).toContainEqual({
      type: "fill-generic-title",
      threadId: "thread-1",
      value: "Recovered title #1",
      source: "desktop-visibility"
    });
    expect(actions).toContainEqual({
      type: "fill-generic-preview",
      threadId: "thread-1",
      value: "Recovered Codex conversation",
      source: "desktop-visibility"
    });
    expect(JSON.stringify(actions)).not.toContain(objective);
  });

  it("does not add session index entries for subagent threads", () => {
    const data = makeLoadedData([
      makeThread({
        id: "subagent-1",
        source: '{"subagent":{"thread_spawn":{"depth":1}}}',
        thread_source: null,
        title: "Subagent",
        preview: "Review details"
      })
    ]);
    data.sessionIndexIds = new Set();

    expect(createRepairPlan(data).actions).not.toContainEqual(
      expect.objectContaining({
        type: "add-session-index-entry",
        threadId: "subagent-1"
      })
    );
  });

  it("applies generic display repairs to sqlite after creating a backup", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-repair-"));
    const dbPath = path.join(codexHome, "state_5.sqlite");
    createThreadsDb(dbPath);

    const db = new Database(dbPath);
    db.prepare("INSERT INTO threads (id, title, preview, cwd) VALUES (?, ?, ?, ?)").run(
      "thread-1",
      "",
      "<permissions instructions>restricted</permissions instructions>",
      "/repo/app"
    );
    db.close();

    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "",
        preview: "<permissions instructions>restricted</permissions instructions>",
        cwd: "/repo/app"
      })
    ]);
    data.paths.codexHome = codexHome;
    data.paths.stateDbPath = dbPath;
    data.paths.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    data.paths.sessionIndexPath = path.join(codexHome, "session_index.jsonl");

    const result = await repairCodexData(data, { backup: true });

    expect(result.backupDir).not.toBeNull();
    expect(fs.existsSync(path.join(result.backupDir!, "state_5.sqlite"))).toBe(true);
    expect(result.appliedActions).toEqual(result.plan.actions);

    const verifyDb = new Database(dbPath, { readonly: true });
    expect(verifyDb.prepare("SELECT title, preview FROM threads WHERE id = ?").get("thread-1")).toEqual({
      title: "Recovered title #1",
      preview: "Recovered Codex conversation"
    });
    verifyDb.close();
  });

  it("updates blank title and preview using the real Codex threads schema shape", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-real-schema-"));
    const dbPath = path.join(codexHome, "state_5.sqlite");
    createRealThreadsDb(dbPath);

    const db = new Database(dbPath);
    insertRealThread(db, {
      id: "thread-1",
      title: "",
      preview: "",
      first_user_message: "Fix repaired Codex chats for creaClient"
    });
    db.close();

    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "",
        preview: "",
        first_user_message: "Fix repaired Codex chats for creaClient"
      })
    ]);
    data.paths.codexHome = codexHome;
    data.paths.stateDbPath = dbPath;
    data.paths.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    data.paths.sessionIndexPath = path.join(codexHome, "session_index.jsonl");

    const result = await repairCodexData(data, { backup: true });

    expect(result.appliedActions).toEqual([
      {
        type: "fill-title",
        threadId: "thread-1",
        value: "Fix repaired Codex chats for creaClient",
        source: "preview"
      },
      {
        type: "fill-preview",
        threadId: "thread-1",
        value: "Fix repaired Codex chats for creaClient",
        source: "first_user_message"
      }
    ]);

    const verifyDb = new Database(dbPath, { readonly: true });
    expect(verifyDb.prepare("SELECT title, preview FROM threads WHERE id = ?").get("thread-1")).toEqual({
      title: "Fix repaired Codex chats for creaClient",
      preview: "Fix repaired Codex chats for creaClient"
    });
    verifyDb.close();
  });

  it("appends missing session index entries and reports the append", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-session-index-"));
    const dbPath = path.join(codexHome, "state_5.sqlite");
    createThreadsDb(dbPath);

    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "Visible thread",
        preview: "Visible preview",
        updated_at_ms: 1_700_000_000_000
      })
    ]);
    data.paths.codexHome = codexHome;
    data.paths.stateDbPath = dbPath;
    data.paths.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    data.paths.sessionIndexPath = path.join(codexHome, "session_index.jsonl");
    data.sessionIndexEntries = [];
    data.sessionIndexIds = new Set();

    const result = await repairCodexData(data, { backup: true });

    expect(result.appliedActions).toEqual([
      {
        type: "add-session-index-entry",
        threadId: "thread-1",
        threadName: "Visible thread",
        updatedAt: "2023-11-14T22:13:20.000Z",
        source: "sqlite-thread"
      }
    ]);
    expect(fs.readFileSync(data.paths.sessionIndexPath, "utf8")).toBe(
      '{"id":"thread-1","thread_name":"Visible thread","updated_at":"2023-11-14T22:13:20.000Z"}\n'
    );
  });

  it("does not report planned sqlite repairs as applied when no row changes", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-noop-"));
    const dbPath = path.join(codexHome, "state_5.sqlite");
    createThreadsDb(dbPath);

    const db = new Database(dbPath);
    db.prepare("INSERT INTO threads (id, title, preview, cwd) VALUES (?, ?, ?, ?)").run(
      "thread-1",
      "Already fixed",
      "Already fixed preview",
      "/repo/app"
    );
    db.close();

    const data = makeLoadedData([
      makeThread({
        id: "thread-1",
        title: "",
        preview: "",
        cwd: "/repo/app"
      })
    ]);
    data.paths.codexHome = codexHome;
    data.paths.stateDbPath = dbPath;
    data.paths.globalStatePath = path.join(codexHome, ".codex-global-state.json");
    data.paths.sessionIndexPath = path.join(codexHome, "session_index.jsonl");

    const result = await repairCodexData(data, { backup: true });

    expect(result.plan.actions).toHaveLength(2);
    expect(result.appliedActions).toEqual([]);
    expect(formatRepairResult(result)).toContain("Actions applied: 0");
  });
});

function makeLoadedData(threads: ThreadRow[], goals: ThreadGoalRow[] = []): LoadedCodexData {
  return {
    paths: {
      codexHome: "/tmp/codex",
      stateDbPath: "/tmp/codex/state_5.sqlite",
      globalStatePath: "/tmp/codex/.codex-global-state.json",
      sessionIndexPath: "/tmp/codex/session_index.jsonl",
      sessionsDir: "/tmp/codex/sessions"
    },
    threads,
    globalState: {},
    savedProjectRoots: [],
    transcripts: [],
    transcriptsByThreadId: new Map(),
    transcriptIds: new Set(),
    threadGoalsByThreadId: new Map(goals.map((goal) => [goal.thread_id, goal])),
    sessionIndexEntries: threads.map((thread) => ({ id: thread.id })),
    sessionIndexIds: new Set(threads.map((thread) => thread.id))
  };
}

function makeThread(overrides: Partial<ThreadRow>): ThreadRow {
  return {
    id: "thread-1",
    rollout_path: "/tmp/session.jsonl",
    created_at: null,
    updated_at: null,
    created_at_ms: null,
    updated_at_ms: null,
    source: "cli",
    thread_source: "user",
    has_user_event: 0,
    cwd: null,
    title: "Good title",
    preview: "Good preview",
    first_user_message: null,
    git_sha: null,
    git_branch: null,
    git_origin_url: null,
    archived: 0,
    ...overrides
  };
}

function makeThreadGoal(overrides: Partial<ThreadGoalRow>): ThreadGoalRow {
  return {
    thread_id: "thread-1",
    goal_id: "goal-1",
    objective: "objective",
    status: "active",
    token_budget: null,
    tokens_used: 0,
    time_used_seconds: 0,
    created_at_ms: 0,
    updated_at_ms: 0,
    ...overrides
  };
}

function createThreadsDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    title TEXT,
    preview TEXT,
    cwd TEXT
  )`);
  db.close();
}

function createRealThreadsDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    sandbox_policy TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    git_sha TEXT,
    git_branch TEXT,
    git_origin_url TEXT,
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    memory_mode TEXT NOT NULL DEFAULT 'enabled',
    model TEXT,
    reasoning_effort TEXT,
    agent_path TEXT,
    created_at_ms INTEGER,
    updated_at_ms INTEGER,
    thread_source TEXT,
    preview TEXT NOT NULL DEFAULT ''
  )`);
  db.close();
}

function insertRealThread(
  db: Database.Database,
  overrides: {
    id: string;
    title: string;
    preview: string;
    first_user_message: string;
  }
): void {
  db.prepare(
    `INSERT INTO threads (
      id,
      rollout_path,
      created_at,
      updated_at,
      source,
      model_provider,
      cwd,
      title,
      sandbox_policy,
      approval_mode,
      has_user_event,
      first_user_message,
      thread_source,
      preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.id,
    "/tmp/session.jsonl",
    1_700_000_000,
    1_700_000_000,
    "cli",
    "openai",
    "/repo/app",
    overrides.title,
    "workspace-write",
    "on-request",
    1,
    overrides.first_user_message,
    "user",
    overrides.preview
  );
}
