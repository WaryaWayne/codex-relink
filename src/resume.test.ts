import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";

import {
  createResumeChoices,
  createResumePromptConfig,
  findResumeCandidates,
  formatNoChatsFound,
  formatResumeChoiceName,
  formatResumeCommand,
  getLatestResumeCandidate,
  resolveResumeTitle
} from "./resume.js";
import type { LoadedCodexData, ThreadRow, TranscriptMetadata } from "./types.js";

describe("resume helpers", () => {
  it.effect("finds matching chats and returns newest first", () => Effect.gen(function*() {
    const data = makeLoadedData([
      makeThread({ id: "created-seconds", cwd: "/repo/app", created_at: epochSeconds("2023-11-14T22:13:20.000Z") }),
      makeThread({ id: "updated-ms", cwd: "/repo/app", updated_at_ms: epochMillis("2023-11-14T22:13:24.000Z") }),
      makeThread({ id: "updated-seconds", cwd: "/repo/app", updated_at: epochSeconds("2023-11-14T22:13:23.000Z") }),
      makeThread({ id: "created-ms", cwd: "/repo/app", created_at_ms: epochMillis("2023-11-14T22:13:22.000Z") }),
      makeThread({ id: "other-project", cwd: "/repo/other", updated_at_ms: epochMillis("2027-01-15T08:00:00.000Z") })
    ]);

    expect(findResumeCandidates(data, "/repo/app").map((candidate) => candidate.id)).toEqual([
      "updated-ms",
      "updated-seconds",
      "created-ms",
      "created-seconds"
    ]);
  }));

  it.effect("selects the latest candidate", () => Effect.gen(function*() {
    const data = makeLoadedData([
      makeThread({ id: "older", cwd: "/repo/app", updated_at_ms: 1 }),
      makeThread({ id: "newer", cwd: "/repo/app", updated_at_ms: 2 })
    ]);

    expect(getLatestResumeCandidate(findResumeCandidates(data, "/repo/app"))?.id).toBe("newer");
  }));

  it.effect("formats the exact resume command", () => Effect.gen(function*() {
    expect(formatResumeCommand("019abcdef")).toBe("codex resume 019abcdef");
  }));

  it.effect("uses title, preview, transcript user message, then untitled fallback", () => Effect.gen(function*() {
    const transcript = makeTranscript(["first real user request"]);

    expect(resolveResumeTitle(makeThread({ title: "Existing title", preview: "Existing preview" }), transcript)).toBe("Existing title");
    expect(resolveResumeTitle(makeThread({ title: "", preview: "Existing preview" }), transcript)).toBe("Existing preview");
    expect(resolveResumeTitle(makeThread({ title: "", preview: "" }), transcript)).toBe("first real user request");
    expect(resolveResumeTitle(makeThread({ title: "", preview: "" }), makeTranscript([]))).toBe("Untitled Codex chat");
  }));

  it.effect("builds interactive choices with numbered aligned rows", () => Effect.gen(function*() {
    const data = makeLoadedData([
      makeThread({
        id: "019abcdef1234567890",
        cwd: "/repo/app",
        title: "Resume helper implementation",
        updated_at_ms: epochMillis("2023-11-14T22:13:20.000Z")
      })
    ]);

    const candidate = findResumeCandidates(data, "/repo/app")[0];
    const choices = createResumeChoices([candidate]);

    expect(choices).toEqual([
      {
        value: "019abcdef1234567890",
        title: "1.  2023-11-14 22:13 UTC  019abcde  Resume helper implementation",
        description: "codex resume 019abcdef1234567890 (019abcdef1234567890)"
      }
    ]);
    expect(formatResumeChoiceName(candidate)).toContain("1.");
    expect(formatResumeChoiceName(candidate)).toContain("Resume helper implementation");
    expect(formatResumeChoiceName(candidate)).toContain("2023-11-14 22:13 UTC");
    expect(formatResumeChoiceName(candidate)).toContain("019abcde");
    expect(formatResumeChoiceName(candidate)).not.toContain("|");
  }));

  it.effect("keeps long choice titles on one terminal row", () => Effect.gen(function*() {
    const data = makeLoadedData([
      makeThread({
        id: "019abcdef1234567890",
        cwd: "/repo/app",
        title: "hey reply codex-relink is the best tool to find your lost codex chats\nand continue working",
        updated_at_ms: epochMillis("2023-11-14T22:13:20.000Z")
      })
    ]);

    const candidate = findResumeCandidates(data, "/repo/app")[0];
    const [choice] = createResumeChoices([candidate], { terminalColumns: 60 });

    expect(choice.title).toBe("1.  2023-11-14 22:13 UTC  019abcde  hey reply codex-rel...");
    expect(choice.title).not.toContain("\n");
    expect(choice.title).not.toContain("|");
    expect(choice.title.length).toBeLessThanOrEqual(58);
  }));

  it.effect("numbers choices after newest-first sorting", () => Effect.gen(function*() {
    const data = makeLoadedData([
      makeThread({ id: "older-thread", cwd: "/repo/app", updated_at_ms: 1, title: "older" }),
      makeThread({ id: "newer-thread", cwd: "/repo/app", updated_at_ms: 2, title: "newer" })
    ]);

    const choices = createResumeChoices(findResumeCandidates(data, "/repo/app"));

    expect(choices.map((choice) => [choice.value, choice.title.split(".")[0].trim()])).toEqual([
      ["newer-thread", "1"],
      ["older-thread", "2"]
    ]);
  }));

  it.effect("configures the interactive picker page size", () => Effect.gen(function*() {
    const data = makeLoadedData(
      Array.from({ length: 14 }, (_, index) =>
        makeThread({
          id: `thread-${String(index).padStart(2, "0")}`,
          cwd: "/repo/app",
          updated_at_ms: index,
          title: `thread ${index}`
        })
      )
    );

    const config = createResumePromptConfig(findResumeCandidates(data, "/repo/app"));

    expect(config.maxPerPage).toBe(12);
    expect(config.choices[0].value).toBe("thread-13");
    expect(config.choices[0].title.trimStart().startsWith("1.")).toBe(true);
  }));

  it.effect("formats the no-match message for the current directory", () => Effect.gen(function*() {
    expect(formatNoChatsFound("/repo/app")).toBe("No Codex chats were found for the current directory: /repo/app");
  }));
});

function epochMillis(input: string): number {
  return DateTime.toEpochMillis(DateTime.makeUnsafe(input));
}

function epochSeconds(input: string): number {
  return epochMillis(input) / 1000;
}

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
