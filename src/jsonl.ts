import { Effect, FileSystem } from "effect";

import { isSyntheticContextText } from "./preview.js";
import type { TranscriptMetadata } from "./types.js";

type JsonObject = Record<string, unknown>;

export const parseJsonlTranscript = Effect.fn("Jsonl.parseJsonlTranscript")(function*(filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const body = yield* fs.readFileString(filePath);
  return parseJsonlTranscriptBody(filePath, body);
});

export function parseJsonlTranscriptBody(filePath: string, body: string): TranscriptMetadata {
  const metadata: TranscriptMetadata = {
    filePath,
    threadId: null,
    cwdMentions: [],
    userMessages: [],
    eventMessages: []
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isObject(parsed)) {
      continue;
    }

    extractThreadId(parsed, metadata);
    extractCwdMentions(parsed, metadata);
    extractUserMessages(parsed, metadata);
    extractEventMessages(parsed, metadata);
  }

  metadata.cwdMentions = uniqueNonBlank(metadata.cwdMentions);
  metadata.userMessages = uniqueNonBlank(metadata.userMessages);
  metadata.eventMessages = uniqueNonBlank(metadata.eventMessages);

  return metadata;
}

function extractThreadId(parsed: JsonObject, metadata: TranscriptMetadata): void {
  if (metadata.threadId) {
    return;
  }

  const candidates = [
    getPath(parsed, ["session_meta", "payload", "id"]),
    getPath(parsed, ["payload", "id"]),
    getPath(parsed, ["id"]),
    getPath(parsed, ["thread_id"]),
    getPath(parsed, ["threadId"])
  ];

  const id = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  if (id) {
    metadata.threadId = id;
  }
}

function extractCwdMentions(parsed: JsonObject, metadata: TranscriptMetadata): void {
  const type = typeof parsed.type === "string" ? parsed.type : null;

  const directCandidates = [
    getPath(parsed, ["session_meta", "payload", "cwd"]),
    getPath(parsed, ["payload", "cwd"]),
    getPath(parsed, ["cwd"]),
    getPath(parsed, ["turn_context", "cwd"]),
    getPath(parsed, ["payload", "turn_context", "cwd"])
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string") {
      metadata.cwdMentions.push(candidate);
    }
  }

  if (type === "turn_context" && typeof parsed.cwd === "string") {
    metadata.cwdMentions.push(parsed.cwd);
  }

  collectValuesForKey(parsed, "workdir", metadata.cwdMentions);
}

function extractUserMessages(parsed: JsonObject, metadata: TranscriptMetadata): void {
  const role = getStringPath(parsed, ["payload", "role"]) ?? getStringPath(parsed, ["role"]);
  const itemRole = getStringPath(parsed, ["payload", "item", "role"]);
  const type = getStringPath(parsed, ["type"]);

  if (role === "user") {
    const text = extractText(getPath(parsed, ["payload", "content"]) ?? getPath(parsed, ["content"]) ?? parsed);
    if (text && !isSyntheticContextText(text)) {
      metadata.userMessages.push(text);
    }
  }

  if (itemRole === "user") {
    const item = getPath(parsed, ["payload", "item"]);
    const text = extractText(getPath(parsed, ["payload", "item", "content"]) ?? item);
    if (text && !isSyntheticContextText(text)) {
      metadata.userMessages.push(text);
    }
  }

  if (type === "user_message") {
    const text = extractText(getPath(parsed, ["payload"]) ?? parsed);
    if (text && !isSyntheticContextText(text)) {
      metadata.userMessages.push(text);
    }
  }
}

function extractEventMessages(parsed: JsonObject, metadata: TranscriptMetadata): void {
  const type = getStringPath(parsed, ["type"]);
  if (type !== "event_msg" && type !== "event") {
    return;
  }

  const candidates = [
    getPath(parsed, ["payload", "message"]),
    getPath(parsed, ["payload", "msg"]),
    getPath(parsed, ["payload", "text"]),
    getPath(parsed, ["message"]),
    getPath(parsed, ["msg"]),
    getPath(parsed, ["text"])
  ];

  for (const candidate of candidates) {
    const text = extractText(candidate);
    if (text) {
      metadata.eventMessages.push(text);
      return;
    }
  }
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() === "" ? null : value;
  }

  if (Array.isArray(value)) {
    const parts = value.map((item) => extractText(item)).filter((item): item is string => item != null);
    return parts.length > 0 ? parts.join(" ") : null;
  }

  if (!isObject(value)) {
    return null;
  }

  const candidateKeys = ["text", "input_text", "message", "content", "body", "value"];
  for (const key of candidateKeys) {
    const text = extractText(value[key]);
    if (text) {
      return text;
    }
  }

  return null;
}

function getPath(value: unknown, keys: string[]): unknown {
  let cursor = value;
  for (const key of keys) {
    if (!isObject(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return cursor;
}

function getStringPath(value: unknown, keys: string[]): string | null {
  const result = getPath(value, keys);
  return typeof result === "string" ? result : null;
}

function collectValuesForKey(value: unknown, key: string, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectValuesForKey(item, key, output);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === "string") {
      output.push(entryValue);
    } else {
      collectValuesForKey(entryValue, key, output);
    }
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function uniqueNonBlank(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
