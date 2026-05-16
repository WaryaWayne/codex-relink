import type { PreviewRecovery, TranscriptMetadata } from "./types.js";

const MAX_PREVIEW_LENGTH = 240;
const MAX_TITLE_LENGTH = 80;

export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isSyntheticContextText(value: string | null | undefined): boolean {
  if (isBlank(value)) {
    return false;
  }

  const cleaned = cleanText(value ?? "").toLowerCase();
  return (
    cleaned.startsWith("<environment_context>") ||
    cleaned.startsWith("&lt;environment_context&gt;") ||
    cleaned.startsWith("<permissions instructions>") ||
    cleaned.startsWith("&lt;permissions instructions&gt;")
  );
}

export function hasUsableDisplayTitle(value: string | null | undefined): boolean {
  return !isBlank(value) && !isSyntheticContextText(value);
}

export function hasUsableDisplayPreview(value: string | null | undefined): boolean {
  return !isBlank(value) && !isSyntheticContextText(value);
}

export function truncateText(value: string, maxLength: number): string {
  const cleaned = cleanText(value);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 1).trimEnd()}...`;
}

export function normalizePreview(value: string): string {
  return truncateText(value, MAX_PREVIEW_LENGTH);
}

export function normalizeTitle(value: string): string {
  return truncateText(value, MAX_TITLE_LENGTH);
}

export function recoverPreview(
  firstUserMessage: string | null | undefined,
  transcript: TranscriptMetadata | null | undefined
): PreviewRecovery | null {
  if (!isBlank(firstUserMessage) && !isSyntheticContextText(firstUserMessage)) {
    const value = firstUserMessage ?? "";
    return {
      value: normalizePreview(value),
      source: "first_user_message"
    };
  }

  const userMessage = transcript?.userMessages.find((message) => !isBlank(message) && !isSyntheticContextText(message));
  if (userMessage) {
    return {
      value: normalizePreview(userMessage),
      source: "transcript_user_message"
    };
  }

  const eventMessage = transcript?.eventMessages.find((message) => !isBlank(message) && !isSyntheticContextText(message));
  if (eventMessage) {
    return {
      value: normalizePreview(eventMessage),
      source: "transcript_event_message"
    };
  }

  return null;
}
