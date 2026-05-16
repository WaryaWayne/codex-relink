import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { loadCodexData } from "./storage.js";

describe("storage", () => {
  it("loads threads through Effect SQLite and transcripts through Effect FileSystem", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-storage-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "16");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, "rollout.jsonl"),
      [
        JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: "/repo/app" } }),
        JSON.stringify({
          type: "response_item",
          payload: { item: { role: "user", content: [{ type: "input_text", text: "recover this chat" }] } }
        })
      ].join("\n")
    );

    await createStateDb(path.join(codexHome, "state_5.sqlite"));

    const data = await runNode(loadCodexData({ codexHome }));

    expect(data.threads).toMatchObject([
      {
        id: "thread-1",
        cwd: "/repo/app",
        title: "Thread title",
        updated_at_ms: 42
      }
    ]);
    expect(data.transcripts).toMatchObject([
      {
        threadId: "thread-1",
        cwdMentions: ["/repo/app"],
        userMessages: ["recover this chat"]
      }
    ]);
    expect(data.transcriptsByThreadId.get("thread-1")?.userMessages).toEqual(["recover this chat"]);
  });
});

function createStateDb(dbPath: string) {
  return Effect.runPromise(
    Effect.gen(function*() {
      const sql = yield* SqliteClient.SqliteClient;
      yield* sql.unsafe("CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT, updated_at_ms INTEGER, title TEXT)");
      yield* sql.unsafe("INSERT INTO threads (id, cwd, updated_at_ms, title) VALUES (?, ?, ?, ?)", [
        "thread-1",
        "/repo/app",
        42,
        "Thread title"
      ]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath, disableWAL: true })), Effect.scoped)
  );
}

function runNode<A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
}
