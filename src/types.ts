export type ThreadRow = {
  id: string;
  rollout_path: string | null;
  created_at: number | null;
  updated_at: number | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  source: string | null;
  thread_source: string | null;
  has_user_event: number | null;
  cwd: string | null;
  title: string | null;
  preview: string | null;
  first_user_message: string | null;
  git_sha: string | null;
  git_branch: string | null;
  git_origin_url: string | null;
  archived: number | null;
};

export type TranscriptMetadata = {
  filePath: string;
  threadId: string | null;
  cwdMentions: string[];
  userMessages: string[];
  eventMessages: string[];
};

export type CodexPaths = {
  codexHome: string;
  stateDbPath: string;
  sessionsDir: string;
};

export type LoadedCodexData = {
  paths: CodexPaths;
  threads: ThreadRow[];
  transcripts: TranscriptMetadata[];
  transcriptsByThreadId: Map<string, TranscriptMetadata>;
};

export type ProjectMatchReason =
  | "exact-cwd"
  | "descendant-cwd"
  | "transcript-cwd"
  | "git-origin";

export type ProjectMatch = {
  matches: boolean;
  reasons: ProjectMatchReason[];
};

export type PreviewSource = "first_user_message" | "transcript_user_message" | "transcript_event_message";

export type PreviewRecovery = {
  value: string;
  source: PreviewSource;
};
