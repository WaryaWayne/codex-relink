import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseJsonlTranscript } from "./jsonl.js";

describe("jsonl transcript parsing", () => {
  it("extracts id, cwd, user messages, event messages, and tool workdir values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-jsonl-"));
    const filePath = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: "/repo/app" } }),
        JSON.stringify({
          type: "response_item",
          payload: { item: { role: "user", content: [{ type: "input_text", text: "please recover this chat" }] } }
        }),
        JSON.stringify({ type: "event_msg", payload: { message: "event fallback" } }),
        JSON.stringify({ type: "tool_call", payload: { workdir: "/repo/app/packages/web" } })
      ].join("\n")
    );

    expect(parseJsonlTranscript(filePath)).toMatchObject({
      filePath,
      threadId: "thread-1",
      cwdMentions: ["/repo/app", "/repo/app/packages/web"],
      userMessages: ["please recover this chat"],
      eventMessages: ["event fallback"]
    });
  });

  it("skips synthetic environment context user messages", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-relink-jsonl-"));
    const filePath = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      filePath,
      [
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
      ].join("\n")
    );

    expect(parseJsonlTranscript(filePath).userMessages).toEqual(["real request"]);
  });
});
