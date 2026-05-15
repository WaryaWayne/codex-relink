import fs from "node:fs";
import path from "node:path";

import { safeTimestamp } from "./paths.js";
import { filterThreadsForProject } from "./scan.js";
import type { LoadedCodexData, ThreadRow } from "./types.js";

export type ExportOptions = {
  project: string;
  output?: string;
};

export type ExportedThread = Pick<
  ThreadRow,
  "id" | "created_at" | "updated_at" | "cwd" | "preview" | "title" | "rollout_path" | "git_branch" | "git_origin_url"
> & {
  resume_command: string;
};

export function exportProjectThreads(data: LoadedCodexData, options: ExportOptions): string {
  const threads = filterThreadsForProject(data, options.project);
  const report = {
    project: options.project,
    generated_at: new Date().toISOString(),
    total_threads: threads.length,
    threads: threads.map(toExportedThread)
  };

  const outputPath =
    options.output ??
    path.resolve(process.cwd(), `codex-relink-${path.basename(options.project)}-${safeTimestamp()}.json`);

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function toExportedThread(thread: ThreadRow): ExportedThread {
  return {
    id: thread.id,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    cwd: thread.cwd,
    preview: thread.preview,
    title: thread.title,
    rollout_path: thread.rollout_path,
    git_branch: thread.git_branch,
    git_origin_url: thread.git_origin_url,
    resume_command: `codex resume ${thread.id}`
  };
}
