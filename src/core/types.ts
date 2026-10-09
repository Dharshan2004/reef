export type ReefItem = {
  id: string;
  type: string;
  status?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  text?: string;
  changes?: { path: string; kind: string }[];
  [key: string]: unknown;
};
export type ReefEvent = {
  id: string;
  sessionId: string;
  seq: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
};
export type Recording = {
  format: "reef";
  version: 1;
  session: {
    id: string;
    title: string;
    prompt: string;
    workingDirectory: string;
    model: string;
    createdAt: string;
    source: "live" | "demo" | "import" | "native";
    observation?: {
      adapter: "codex-hooks";
      coverage: "structural";
      limitations: string[];
    };
    creatureName?: string;
  };
  events: ReefEvent[];
};
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  [key: string]: number | undefined;
};
export type SessionState = {
  status:
    | "starting"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown"
    | "stopped"
    | "interrupted"
    | "ended"
    | "waiting";
  items: ReefItem[];
  usage: Usage | null;
  reportedFiles: { path: string; kind: string; status: string }[];
  commandFailures: number;
  lastEventAt: string | null;
  threadId: string | null;
  error: string | null;
};
