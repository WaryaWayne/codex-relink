import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { isSameOrDescendantPath, matchThreadToProject } from "./project.js";
import type { ThreadRow } from "./types.js";

const baseThread: ThreadRow = {
  id: "thread-1",
  rollout_path: null,
  created_at: null,
  updated_at: null,
  created_at_ms: null,
  updated_at_ms: null,
  source: "cli",
  thread_source: "user",
  has_user_event: 0,
  cwd: null,
  title: null,
  preview: null,
  first_user_message: null,
  git_sha: null,
  git_branch: null,
  git_origin_url: null,
  archived: 0
};

describe("project matching", () => {
  it.effect("matches exact paths", () => Effect.gen(function*() {
    expect(isSameOrDescendantPath("/repo/app", "/repo/app")).toBe("exact");
  }));

  it.effect("matches descendant paths", () => Effect.gen(function*() {
    expect(isSameOrDescendantPath("/repo/app/packages/web", "/repo/app")).toBe("descendant");
  }));

  it.effect("rejects sibling paths", () => Effect.gen(function*() {
    expect(isSameOrDescendantPath("/repo/application", "/repo/app")).toBeNull();
  }));

  it.effect("matches threads by exact cwd", () => Effect.gen(function*() {
    const match = matchThreadToProject({ ...baseThread, cwd: "/repo/app" }, "/repo/app");
    expect(match).toEqual({ matches: true, reasons: ["exact-cwd"] });
  }));

  it.effect("matches threads by descendant cwd", () => Effect.gen(function*() {
    const match = matchThreadToProject({ ...baseThread, cwd: "/repo/app/subdir" }, "/repo/app");
    expect(match).toEqual({ matches: true, reasons: ["descendant-cwd"] });
  }));

  it.effect("matches threads by transcript cwd mentions", () => Effect.gen(function*() {
    const match = matchThreadToProject({ ...baseThread, cwd: null }, "/repo/app", {
      filePath: "/tmp/session.jsonl",
      threadId: "thread-1",
      cwdMentions: ["/repo/app"],
      userMessages: [],
      eventMessages: []
    });

    expect(match).toEqual({ matches: true, reasons: ["transcript-cwd"] });
  }));
});
