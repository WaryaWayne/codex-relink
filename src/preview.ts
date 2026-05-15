import type { PreviewRecovery, TranscriptMetadata } from "./types.js";

const MAX_PREVIEW_LENGTH = 240;
const MAX_TITLE_LENGTH = 80;

export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  if (!isBlank(firstUserMessage)) {
    const value = firstUserMessage ?? "";
    return {
      value: normalizePreview(value),
      source: "first_user_message"
    };
  }

  const userMessage = transcript?.userMessages.find((message) => !isBlank(message));
  if (userMessage) {
    return {
      value: normalizePreview(userMessage),
      source: "transcript_user_message"
    };
  }

  const eventMessage = transcript?.eventMessages.find((message) => !isBlank(message));
  if (eventMessage) {
    return {
      value: normalizePreview(eventMessage),
      source: "transcript_event_message"
    };
  }

  return null;
}
