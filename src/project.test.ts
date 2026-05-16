import { describe, expect, it } from "vitest";

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
  it("matches exact paths", () => {
    expect(isSameOrDescendantPath("/repo/app", "/repo/app")).toBe("exact");
  });

  it("matches descendant paths", () => {
    expect(isSameOrDescendantPath("/repo/app/packages/web", "/repo/app")).toBe("descendant");
  });

  it("rejects sibling paths", () => {
    expect(isSameOrDescendantPath("/repo/application", "/repo/app")).toBeNull();
  });

  it("matches threads by exact cwd", () => {
    const match = matchThreadToProject({ ...baseThread, cwd: "/repo/app" }, "/repo/app");
    expect(match).toEqual({ matches: true, reasons: ["exact-cwd"] });
  });

  it("matches threads by descendant cwd", () => {
    const match = matchThreadToProject({ ...baseThread, cwd: "/repo/app/subdir" }, "/repo/app");
    expect(match).toEqual({ matches: true, reasons: ["descendant-cwd"] });
  });

  it("matches threads by transcript cwd mentions", () => {
    const match = matchThreadToProject({ ...baseThread, cwd: null }, "/repo/app", {
      filePath: "/tmp/session.jsonl",
      threadId: "thread-1",
      cwdMentions: ["/repo/app"],
      userMessages: [],
      eventMessages: []
    });

    expect(match).toEqual({ matches: true, reasons: ["transcript-cwd"] });
  });
});
