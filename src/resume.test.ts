import { describe, expect, it } from "vitest";

import {
  createResumeChoices,
  findResumeCandidates,
  formatNoChatsFound,
  formatResumeChoiceName,
  formatResumeCommand,
  getLatestResumeCandidate,
  resolveResumeTitle
} from "./resume.js";
import type { LoadedCodexData, ThreadRow, TranscriptMetadata } from "./types.js";

describe("resume helpers", () => {
  it("finds matching chats and returns newest first", () => {
    const data = makeLoadedData([
      makeThread({ id: "created-seconds", cwd: "/repo/app", created_at: 1_700_000_000 }),
      makeThread({ id: "updated-ms", cwd: "/repo/app", updated_at_ms: 1_700_000_004_000 }),
      makeThread({ id: "updated-seconds", cwd: "/repo/app", updated_at: 1_700_000_003 }),
      makeThread({ id: "created-ms", cwd: "/repo/app", created_at_ms: 1_700_000_002_000 }),
      makeThread({ id: "other-project", cwd: "/repo/other", updated_at_ms: 1_800_000_000_000 })
    ]);

    expect(findResumeCandidates(data, "/repo/app").map((candidate) => candidate.id)).toEqual([
      "updated-ms",
      "updated-seconds",
      "created-ms",
      "created-seconds"
    ]);
  });

  it("selects the latest candidate", () => {
    const data = makeLoadedData([
      makeThread({ id: "older", cwd: "/repo/app", updated_at_ms: 1 }),
      makeThread({ id: "newer", cwd: "/repo/app", updated_at_ms: 2 })
    ]);

    expect(getLatestResumeCandidate(findResumeCandidates(data, "/repo/app"))?.id).toBe("newer");
  });

  it("formats the exact resume command", () => {
    expect(formatResumeCommand("019abcdef")).toBe("codex resume 019abcdef");
  });

  it("uses title, preview, transcript user message, then untitled fallback", () => {
    const transcript = makeTranscript(["first real user request"]);

    expect(resolveResumeTitle(makeThread({ title: "Existing title", preview: "Existing preview" }), transcript)).toBe("Existing title");
    expect(resolveResumeTitle(makeThread({ title: "", preview: "Existing preview" }), transcript)).toBe("Existing preview");
    expect(resolveResumeTitle(makeThread({ title: "", preview: "" }), transcript)).toBe("first real user request");
    expect(resolveResumeTitle(makeThread({ title: "", preview: "" }), makeTranscript([]))).toBe("Untitled Codex chat");
  });

  it("builds interactive choices with readable rows", () => {
    const data = makeLoadedData([
      makeThread({
        id: "019abcdef1234567890",
        cwd: "/repo/app",
        title: "Resume helper implementation",
        updated_at_ms: 1_700_000_000_000
      })
    ]);

    const candidate = findResumeCandidates(data, "/repo/app")[0];
    const choices = createResumeChoices([candidate]);

    expect(choices).toEqual([
      {
        value: "019abcdef1234567890",
        name: "Resume helper implementation | 2023-11-14 22:13 UTC | 019abcde",
        short: "019abcde",
        description: "codex resume 019abcdef1234567890 (019abcdef1234567890)"
      }
    ]);
    expect(formatResumeChoiceName(candidate)).toContain("Resume helper implementation");
    expect(formatResumeChoiceName(candidate)).toContain("2023-11-14 22:13 UTC");
    expect(formatResumeChoiceName(candidate)).toContain("019abcde");
  });

  it("formats the no-match message for the current directory", () => {
    expect(formatNoChatsFound("/repo/app")).toBe("No Codex chats were found for the current directory: /repo/app");
  });
});

function makeLoadedData(threads: ThreadRow[]): LoadedCodexData {
  return {
    paths: {
      codexHome: "/tmp/codex",
      stateDbPath: "/tmp/codex/state_5.sqlite",
      sessionsDir: "/tmp/codex/sessions"
    },
    threads,
    transcripts: [],
    transcriptsByThreadId: new Map()
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
    has_user_event: 1,
    cwd: "/repo/app",
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

function makeTranscript(userMessages: string[]): TranscriptMetadata {
  return {
    filePath: "/tmp/session.jsonl",
    threadId: "thread-1",
    cwdMentions: [],
    userMessages,
    eventMessages: []
  };
}
