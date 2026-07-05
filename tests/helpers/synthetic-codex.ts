import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SyntheticCodexCorpus = {
  sessionsDir: string;
  files: string[];
};

export type SyntheticCodexSessionOptions = {
  threadId: string;
  title: string;
  finalMessage: string;
  cwd?: string;
  timestamp?: string;
  branch?: string;
  commitHash?: string;
};

export function syntheticCodexJsonl(options: SyntheticCodexSessionOptions): string {
  const timestamp = options.timestamp ?? "2026-07-06T00:00:00.000Z";
  const cwd = options.cwd ?? "/Volumes/LEXAR/repos/example";
  const branch = options.branch ?? "main";
  const commitHash = options.commitHash ?? "abc1234";
  const lines = [
    {
      timestamp,
      session_meta: {
        payload: {
          id: options.threadId,
          cwd,
          model: "gpt-5.5",
          git: { branch, commit_hash: commitHash }
        }
      }
    },
    {
      timestamp,
      event_msg: {
        type: "thread_name",
        name: options.title
      }
    },
    {
      timestamp,
      response_item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: `<proposed_plan>\n# ${options.title}\nRun the deterministic issue 549 indexing scenario.\n</proposed_plan>`
          }
        ]
      }
    },
    {
      timestamp,
      response_item: {
        type: "function_call",
        call_id: `call_${options.threadId}`,
        name: "functions.exec_command",
        arguments: "{\"cmd\":\"sed -n '1,20p' packages/core/src/index.ts\"}"
      }
    },
    {
      timestamp,
      event_msg: {
        type: "agent_message",
        message: options.finalMessage
      }
    }
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

export function writeSyntheticCodexSession(path: string, options: SyntheticCodexSessionOptions): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, syntheticCodexJsonl(options));
}

export function writeSyntheticCodexCorpus(root: string, sessions: number): SyntheticCodexCorpus {
  const sessionsDir = join(root, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const files: string[] = [];
  for (let index = 0; index < sessions; index += 1) {
    const threadId = `019f-bench-${String(index).padStart(6, "0")}`;
    const file = join(sessionsDir, `rollout-2026-07-06T00-00-00-${threadId}.jsonl`);
    writeSyntheticCodexSession(file, {
      threadId,
      title: `Synthetic issue 549 session ${index}`,
      finalMessage: `Final: synthetic issue 549 session ${index} completed. Next action: benchmark no-change reindex.`,
      timestamp: new Date(Date.UTC(2026, 6, 6, 0, 0, index % 60)).toISOString()
    });
    files.push(file);
  }
  return { sessionsDir, files };
}
