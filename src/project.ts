import { basenameFsPath, isAbsoluteFsPath, normalizeFsPath, relativeFsPath } from "./paths.js";
import type { LoadedCodexData, ProjectMatch, ThreadRow, TranscriptMetadata } from "./types.js";

export function isSameOrDescendantPath(candidateInput: string, rootInput: string): "exact" | "descendant" | null {
  const candidate = normalizeFsPath(candidateInput);
  const root = normalizeFsPath(rootInput);

  if (candidate === root) {
    return "exact";
  }

  const relative = relativeFsPath(root, candidate);
  if (relative && !relative.startsWith("..") && !isAbsoluteFsPath(relative)) {
    return "descendant";
  }

  return null;
}

export function matchThreadToProject(
  thread: ThreadRow,
  projectRootInput: string,
  transcript?: TranscriptMetadata | null
): ProjectMatch {
  const reasons: ProjectMatch["reasons"] = [];
  const projectRoot = normalizeFsPath(projectRootInput);

  if (thread.cwd) {
    const cwdMatch = isSameOrDescendantPath(thread.cwd, projectRoot);
    if (cwdMatch === "exact") {
      reasons.push("exact-cwd");
    } else if (cwdMatch === "descendant") {
      reasons.push("descendant-cwd");
    }
  }

  if (transcript?.cwdMentions.some((cwd) => isSameOrDescendantPath(cwd, projectRoot) != null)) {
    reasons.push("transcript-cwd");
  }

  const projectBase = basenameFsPath(projectRoot).toLowerCase();
  if (thread.git_origin_url?.toLowerCase().includes(projectBase)) {
    reasons.push("git-origin");
  }

  return {
    matches: reasons.length > 0,
    reasons
  };
}

export function filterThreadsForProject(data: LoadedCodexData, projectRoot: string): ThreadRow[] {
  return data.threads.filter((thread) => {
    const transcript = data.transcriptsByThreadId.get(thread.id);
    return matchThreadToProject(thread, projectRoot, transcript).matches;
  });
}
