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

export type ThreadGoalRow = {
  thread_id: string;
  goal_id: string | null;
  objective: string | null;
  status: string | null;
  token_budget: number | null;
  tokens_used: number | null;
  time_used_seconds: number | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
};

export type GlobalState = Record<string, unknown>;

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
  globalStatePath: string;
  sessionIndexPath: string;
  sessionsDir: string;
};

export type SessionIndexEntry = {
  id: string;
  thread_name?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type LoadedCodexData = {
  paths: CodexPaths;
  threads: ThreadRow[];
  globalState: GlobalState;
  savedProjectRoots: string[];
  transcripts: TranscriptMetadata[];
  transcriptsByThreadId: Map<string, TranscriptMetadata>;
  transcriptIds: Set<string>;
  threadGoalsByThreadId: Map<string, ThreadGoalRow>;
  sessionIndexEntries: SessionIndexEntry[];
  sessionIndexIds: Set<string>;
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

export type RepairAction =
  | {
      type: "fill-preview";
      threadId: string;
      value: string;
      source: PreviewSource;
    }
  | {
      type: "fill-title";
      threadId: string;
      value: string;
      source: "preview";
    }
  | {
      type: "fill-generic-preview";
      threadId: string;
      value: "Recovered Codex conversation";
      source: "desktop-visibility";
    }
  | {
      type: "fill-generic-title";
      threadId: string;
      value: string;
      source: "desktop-visibility";
    }
  | {
      type: "set-workspace-root-hint";
      threadId: string;
      value: string;
      source: "saved-project-root";
    }
  | {
      type: "remap-cwd";
      threadId: string;
      from: string;
      to: string;
      source: "saved-project-root";
    }
  | {
      type: "add-session-index-entry";
      threadId: string;
      threadName: string;
      updatedAt: string;
      source: "sqlite-thread";
    };

export type RepairPlan = {
  actions: RepairAction[];
  unappliedOptionalActions: RepairAction[];
};
