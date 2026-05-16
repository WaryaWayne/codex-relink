import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { parseJsonlTranscript } from "./jsonl.js";

layer(NodeServices.layer)("jsonl transcript parsing", (it) => {
  it.effect("extracts id, cwd, user messages, event messages, and tool workdir values", () =>
    Effect.gen(function*() {
      const filePath = yield* writeTranscript([
        JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: "/repo/app" } }),
        JSON.stringify({
          type: "response_item",
          payload: { item: { role: "user", content: [{ type: "input_text", text: "please recover this chat" }] } }
        }),
        JSON.stringify({ type: "event_msg", payload: { message: "event fallback" } }),
        JSON.stringify({ type: "tool_call", payload: { workdir: "/repo/app/packages/web" } })
      ]);

      const transcript = yield* parseJsonlTranscript(filePath);

      expect(transcript).toMatchObject({
        filePath,
        threadId: "thread-1",
        cwdMentions: ["/repo/app", "/repo/app/packages/web"],
        userMessages: ["please recover this chat"],
        eventMessages: ["event fallback"]
      });
    }));

  it.effect("skips synthetic environment context user messages", () =>
    Effect.gen(function*() {
      const filePath = yield* writeTranscript([
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/repo/app</cwd>\n</environment_context>" }]
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "real request" }] }
        })
      ]);

      const transcript = yield* parseJsonlTranscript(filePath);

      expect(transcript.userMessages).toEqual(["real request"]);
    }));
});

function writeTranscript(lines: string[]) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "codex-relink-jsonl-" });
    const filePath = path.join(dir, "session.jsonl");
    yield* fs.writeFileString(filePath, lines.join("\n"));
    return filePath;
  });
}
