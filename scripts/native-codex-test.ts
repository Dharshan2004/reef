// Manual account-backed test. Requires installed Reef and explicitly trusted hooks.
// Does not bypass hook trust or change user configuration. Never run in CI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readNativeRecording } from "../plugin/native";
import { deriveSession } from "../src/core";
import {
  getIsolationOverrides,
  resolveCodexExecutable,
} from "../server/codex-config";

const execute = promisify(execFile);
const executable = resolveCodexExecutable();
const cwd = resolve(".");
const signal = AbortSignal.timeout(120_000);
const { stdout } = await execute(executable, ["plugin", "list", "--json"], {
  cwd,
  signal,
  maxBuffer: 4_000_000,
});
const metadata = JSON.parse(stdout) as { installed: { pluginId: string }[] };
const plugins = [
  "_default={enabled=false}",
  ...metadata.installed
    .filter((p) => p.pluginId !== "reef@reef-local")
    .map((p) => `${JSON.stringify(p.pluginId)}={enabled=false}`),
  '"reef@reef-local"={enabled=true}',
];
const isolated = await getIsolationOverrides(executable, cwd, signal);
assert.ok(isolated.length, "Unset REEF_INHERIT_TOOLS for this bounded probe");
const config = [
  ...isolated,
  "features.plugins=true",
  "features.hooks=true",
  `plugins={${plugins.join(",")}}`,
].flatMap((value) => ["-c", value]);
const catalog = await execute(
  executable,
  [...config, "mcp", "list", "--json"],
  { cwd, signal, maxBuffer: 4_000_000 },
);
assert.deepEqual(
  JSON.parse(catalog.stdout)
    .filter((entry: { enabled: boolean }) => entry.enabled)
    .map((entry: { name: string }) => entry.name),
  ["reef"],
);
const result = await new Promise<{ stdout: string; stderr: string }>(
  (accept, reject) => {
    const child = execFile(
      executable,
      [
        ...config,
        "exec",
        "--ephemeral",
        "--json",
        "-m",
        "gpt-6.1-sol",
        "-s",
        "read-only",
        "Run exactly one shell command: printf reef-native-observation-probe. Do not read or modify files and do not call other tools. Then confirm it returned in one sentence.",
      ],
      { cwd, signal, maxBuffer: 4_000_000, encoding: "utf8" },
      (error, stdout, stderr) =>
        error
          ? reject(
              new Error(
                "Native probe failed; no private process output exposed",
              ),
            )
          : accept({ stdout, stderr }),
    );
    child.stdin?.end();
  },
);
const events = result.stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const sessionId = events.find(
  (event) => event.type === "thread.started",
)?.thread_id;
assert.equal(typeof sessionId, "string");
const commands = events.filter(
  (event) =>
    event.type === "item.completed" && event.item?.type === "command_execution",
);
assert.equal(commands.length, 1);
assert.equal(commands[0].item.exit_code, 0);
const directory = "/tmp/reef-native-codex-proof";
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(`${directory}/events.jsonl`, result.stdout, { mode: 0o600 });
// Raw stderr may contain private configuration; retain it only in temporary private storage.
await writeFile(`${directory}/stderr.txt`, result.stderr, { mode: 0o600 });
const reefTransport = JSON.parse(catalog.stdout).find(
  (entry: { name: string }) => entry.name === "reef",
)?.transport;
const configuredData = reefTransport?.env?.PLUGIN_DATA;
assert.equal(
  typeof configuredData,
  "string",
  "Reef MCP needs an explicit native store mapping on legacy Codex",
);
const dataDir = resolve(reefTransport.cwd ?? cwd, configuredData);
let recording = await readNativeRecording(`native-${sessionId}`, dataDir);
for (
  let attempt = 0;
  attempt < 10 && (!recording || deriveSession(recording).status !== "ended");
  attempt++
) {
  await new Promise((done) => setTimeout(done, 100));
  recording = await readNativeRecording(`native-${sessionId}`, dataDir);
}
assert.ok(
  recording,
  "Trusted hooks must deliver a native recording; run /hooks to review Reef",
);
const eventTypes = recording.events.map((event) => event.type);
for (const type of [
  "native.session_started",
  "native.turn_started",
  "native.tool_started",
  "native.tool_finished",
  "native.stopped",
  "native.ended",
])
  assert.ok(eventTypes.includes(type), type);
const state = deriveSession(recording);
assert.equal(state.status, "ended");
assert.equal(state.items.length, 1);
assert.equal(state.items[0]?.status, "observed_finished");
assert.equal(state.usage, null);
assert.ok(!JSON.stringify(recording).includes("reef-native-observation-probe"));
await writeFile(
  `${directory}/recording.reef`,
  JSON.stringify(recording, null, 2),
  { mode: 0o600 },
);
const proof = {
  sessionId,
  toolCalls: commands.length,
  commandReturned: true,
  hookReviewWarning: result.stderr
    .split("\n")
    .some((line) => /hook/i.test(line) && /review|trust/i.test(line)),
  observationVerified: true,
  eventTypes,
  state: state.status,
  commandContentOmitted: true,
};
await writeFile(`${directory}/probe.json`, JSON.stringify(proof, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(proof));
console.log(
  "PASS: real native Codex hooks recorded the command lifecycle without recording command content.",
);
