import { describe, expect, it } from "vitest";

import { hasUsableDisplayPreview, hasUsableDisplayTitle, isBlank, isSyntheticContextText, recoverPreview } from "./preview.js";
import type { TranscriptMetadata } from "./types.js";

const emptyTranscript: TranscriptMetadata = {
  filePath: "/tmp/session.jsonl",
  threadId: "thread-1",
  cwdMentions: [],
  userMessages: [],
  eventMessages: []
};

describe("preview recovery", () => {
  it("detects blank values", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank("hello")).toBe(false);
  });

  it("recovers preview from first_user_message first", () => {
    expect(recoverPreview("  please fix this  ", emptyTranscript)).toEqual({
      value: "please fix this",
      source: "first_user_message"
    });
  });

  it("recovers preview from transcript user messages", () => {
    expect(
      recoverPreview("", {
        ...emptyTranscript,
        userMessages: ["build the CLI"]
      })
    ).toEqual({
      value: "build the CLI",
      source: "transcript_user_message"
    });
  });

  it("recovers preview from transcript event messages when user messages are unavailable", () => {
    expect(
      recoverPreview("", {
        ...emptyTranscript,
        eventMessages: ["User asked for scan output"]
      })
    ).toEqual({
      value: "User asked for scan output",
      source: "transcript_event_message"
    });
  });

  it("skips synthetic environment context when recovering previews", () => {
    const environmentContext =
      "<environment_context>\n  <cwd>/Users/bdmwarya/Desktop/projects/creaClient</cwd>\n  <shell>zsh</shell>\n</environment_context>";

    expect(isSyntheticContextText(environmentContext)).toBe(true);
    expect(
      recoverPreview(environmentContext, {
        ...emptyTranscript,
        userMessages: [environmentContext, "actual user request"]
      })
    ).toEqual({
      value: "actual user request",
      source: "transcript_user_message"
    });
  });

  it("treats synthetic display metadata as unusable", () => {
    expect(hasUsableDisplayTitle("A real title")).toBe(true);
    expect(hasUsableDisplayTitle("<permissions instructions>tool limits</permissions instructions>")).toBe(false);
    expect(hasUsableDisplayPreview("&lt;environment_context&gt;cwd&lt;/environment_context&gt;")).toBe(false);
  });
});
