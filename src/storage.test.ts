import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { loadCodexData } from "./storage.js";

layer(NodeServices.layer)("storage", (it) => {
  it.effect("loads threads through Effect SQLite and transcripts through Effect FileSystem", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = yield* fs.makeTempDirectoryScoped({ prefix: "codex-relink-storage-" });
      const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "16");
      yield* fs.makeDirectory(sessionsDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(sessionsDir, "rollout.jsonl"),
        [
          JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: "/repo/app" } }),
          JSON.stringify({
            type: "response_item",
            payload: { item: { role: "user", content: [{ type: "input_text", text: "recover this chat" }] } }
          })
        ].join("\n")
      );

      yield* createStateDb(path.join(codexHome, "state_5.sqlite"));

      const data = yield* loadCodexData({ codexHome });

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
    }));
});

function createStateDb(dbPath: string) {
  return Effect.gen(function*() {
    const sql = yield* SqliteClient.SqliteClient;
    yield* sql.unsafe("CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT, updated_at_ms INTEGER, title TEXT)");
    yield* sql.unsafe("INSERT INTO threads (id, cwd, updated_at_ms, title) VALUES (?, ?, ?, ?)", [
      "thread-1",
      "/repo/app",
      42,
      "Thread title"
    ]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath, disableWAL: true })), Effect.scoped);
}
