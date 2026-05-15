import fs from "node:fs";
import path from "node:path";

import { resolveMaybeRelativePath } from "./paths.js";
import { isBlank } from "./preview.js";
import { looksSuspiciousCwd, matchThreadToProject } from "./project.js";
import { getProjectlessThreadIds } from "./storage.js";
import type { LoadedCodexData, ThreadRow } from "./types.js";

export type ScanOptions = {
  project?: string;
};

export type ScanReport = {
  totalThreads: number;
  activeThreads: number;
  savedProjectRoots: string[];
  threadsByCwd: Array<{ cwd: string; count: number; blankPreviewCount: number }>;
  blankPreviewThreads: ThreadSummary[];
  missingRolloutFiles: ThreadSummary[];
  rolloutFilesMissingFromSqlite: Array<{ filePath: string; threadId: string | null }>;
  projectlessThreads: ThreadSummary[];
  suspiciousCwds: Array<{ cwd: string; count: number; flags: string[] }>;
};

export type ThreadSummary = {
  id: string;
  cwd: string | null;
  title: string | null;
  preview: string | null;
  rollout_path: string | null;
  updated_at: number | null;
};

export function createScanReport(data: LoadedCodexData, options: ScanOptions = {}): ScanReport {
  const threads = filterThreadsForProject(data, options.project);
  const threadIds = new Set(data.threads.map((thread) => thread.id));
  const projectlessIds = getProjectlessThreadIds(data.globalState);
  const cwdCounts = new Map<string, { count: number; blankPreviewCount: number }>();

  for (const thread of threads) {
    const cwd = thread.cwd?.trim() || "(blank)";
    const current = cwdCounts.get(cwd) ?? { count: 0, blankPreviewCount: 0 };
    current.count += 1;
    if (isBlank(thread.preview)) {
      current.blankPreviewCount += 1;
    }
    cwdCounts.set(cwd, current);
  }

  const missingRolloutFiles = threads.filter((thread) => {
    const rolloutPath = resolveMaybeRelativePath(data.paths.codexHome, thread.rollout_path);
    return rolloutPath == null || !fs.existsSync(rolloutPath);
  });

  const transcriptFiles = options.project
    ? data.transcripts.filter((transcript) =>
        transcript.cwdMentions.some(
          (cwd) => matchThreadToProject({ ...emptyThread, id: transcript.threadId ?? "", cwd }, options.project!, transcript).matches
        )
      )
    : data.transcripts;

  const suspiciousCwdCounts = new Map<string, { count: number; flags: string[] }>();
  for (const thread of threads) {
    const cwd = thread.cwd?.trim() || "(blank)";
    const flags = looksSuspiciousCwd(thread.cwd, data.savedProjectRoots);
    if (flags.length === 0) {
      continue;
    }
    const current = suspiciousCwdCounts.get(cwd) ?? { count: 0, flags };
    current.count += 1;
    suspiciousCwdCounts.set(cwd, current);
  }

  return {
    totalThreads: threads.length,
    activeThreads: threads.filter((thread) => thread.archived !== 1).length,
    savedProjectRoots: data.savedProjectRoots,
    threadsByCwd: Array.from(cwdCounts.entries())
      .map(([cwd, value]) => ({ cwd, ...value }))
      .sort((left, right) => right.count - left.count || left.cwd.localeCompare(right.cwd)),
    blankPreviewThreads: threads.filter((thread) => isBlank(thread.preview)).map(summarizeThread),
    missingRolloutFiles: missingRolloutFiles.map(summarizeThread),
    rolloutFilesMissingFromSqlite: transcriptFiles
      .filter((transcript) => !transcript.threadId || !threadIds.has(transcript.threadId))
      .map((transcript) => ({ filePath: transcript.filePath, threadId: transcript.threadId })),
    projectlessThreads: threads.filter((thread) => projectlessIds.has(thread.id)).map(summarizeThread),
    suspiciousCwds: Array.from(suspiciousCwdCounts.entries())
      .map(([cwd, value]) => ({ cwd, ...value }))
      .sort((left, right) => right.count - left.count || left.cwd.localeCompare(right.cwd))
  };
}

export function filterThreadsForProject(data: LoadedCodexData, project?: string): ThreadRow[] {
  if (!project) {
    return data.threads;
  }

  return data.threads.filter((thread) => {
    const transcript = data.transcriptsByThreadId.get(thread.id);
    return matchThreadToProject(thread, project, transcript).matches;
  });
}

export function summarizeThread(thread: ThreadRow): ThreadSummary {
  return {
    id: thread.id,
    cwd: thread.cwd,
    title: thread.title,
    preview: thread.preview,
    rollout_path: thread.rollout_path,
    updated_at: thread.updated_at
  };
}

export function formatScanReport(report: ScanReport, project?: string): string {
  const lines: string[] = [];
  lines.push(project ? `Codex relink scan for ${project}` : "Codex relink scan");
  lines.push("");
  lines.push(`Total threads: ${report.totalThreads}`);
  lines.push(`Active threads: ${report.activeThreads}`);
  lines.push(`Saved project roots: ${report.savedProjectRoots.length}`);
  lines.push(`Blank preview threads: ${report.blankPreviewThreads.length}`);
  lines.push(`Threads with missing rollout files: ${report.missingRolloutFiles.length}`);
  lines.push(`Rollout files missing from SQLite: ${report.rolloutFilesMissingFromSqlite.length}`);
  lines.push(`Projectless threads: ${report.projectlessThreads.length}`);
  lines.push("");
  lines.push("Top cwd values:");

  for (const entry of report.threadsByCwd.slice(0, 20)) {
    lines.push(`- ${entry.count} thread(s), ${entry.blankPreviewCount} blank preview: ${entry.cwd}`);
  }

  if (report.suspiciousCwds.length > 0) {
    lines.push("");
    lines.push("Suspicious cwd values:");
    for (const entry of report.suspiciousCwds.slice(0, 20)) {
      lines.push(`- ${entry.count} thread(s), ${entry.flags.join(", ")}: ${entry.cwd}`);
    }
  }

  if (report.blankPreviewThreads.length > 0) {
    lines.push("");
    lines.push("Blank preview thread samples:");
    for (const thread of report.blankPreviewThreads.slice(0, 10)) {
      lines.push(`- ${thread.id} ${thread.cwd ?? "(blank cwd)"}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const emptyThread: ThreadRow = {
  id: "",
  rollout_path: null,
  created_at: null,
  updated_at: null,
  cwd: null,
  title: null,
  preview: null,
  first_user_message: null,
  git_sha: null,
  git_branch: null,
  git_origin_url: null,
  archived: null
};
