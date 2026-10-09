import { test } from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type Runner } from "../server/session-manager";
import { createApi } from "../server/api";
import {
  isolationOverrides,
  resolveCodexExecutable,
  getIsolationOverrides,
} from "../server/codex-config";
import { deriveSession } from "../src/core/index";
test("integration isolation projects only names and disables plugins/apps", () => {
  const config = isolationOverrides(
    JSON.stringify([
      { name: "private_tool", transport: { env: { TOKEN: "never-export" } } },
      { name: "private_tool" },
    ]),
  );
  assert.deepEqual(config, [
    "features.plugins=false",
    "features.apps=false",
    "mcp_servers.private_tool.enabled=false",
  ]);
  assert.ok(!JSON.stringify(config).includes("never-export"));
  assert.throws(() => isolationOverrides("{}"), /format/);
  assert.throws(
    () => isolationOverrides('[{"name":"bad.name"}]'),
    /unsupported/,
  );
});
test("SDK native CLI resolver selects an installed executable", () => {
  assert.ok(
    resolveCodexExecutable().endsWith(
      process.platform === "win32" ? "codex.exe" : "codex",
    ),
  );
});
test("enumeration disables plugins before selecting standalone server overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-cli-test-"));
  try {
    const fake = join(dir, "fake-codex");
    await writeFile(
      fake,
      `#!${process.execPath}\nconst args=process.argv.slice(2);console.log(JSON.stringify(args.includes('features.plugins=false')&&args.includes('features.apps=false')?[{name:'standalone'}]:[{name:'plugin-provided'},{name:'standalone'}]));\n`,
      { mode: 0o700 },
    );
    const config = await getIsolationOverrides(
      fake,
      dir,
      new AbortController().signal,
    );
    assert.ok(config.includes("mcp_servers.standalone.enabled=false"));
    assert.ok(!config.some((v) => v.includes("plugin-provided")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("cleanup errors after turn completion preserve the reported outcome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  try {
    const manager = new SessionManager(dir, async function* () {
      yield { type: "turn.completed" };
      throw new Error("stream cleanup");
    });
    await manager.load();
    const r = manager.start({ prompt: "test", workingDirectory: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await manager.flush();
    assert.equal(deriveSession(r).status, "completed");
    assert.equal(r.events.at(-1)?.type, "session.disconnected");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manager records event sequence durably and restores without execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  try {
    const runner: Runner = async function* () {
      yield { type: "turn.started" };
      yield {
        type: "turn.completed",
        usage: { input_tokens: 2, output_tokens: 1 },
      };
    };
    const manager = new SessionManager(dir, runner);
    await manager.load();
    const r = manager.start({ prompt: "test", workingDirectory: dir });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await manager.flush();
    assert.equal(deriveSession(r).status, "completed");
    const restored = new SessionManager(dir, () => {
      throw new Error("must not run");
    });
    await restored.load();
    assert.deepEqual(restored.get(r.session.id), r);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("cancellation aborts the run and remains distinct from failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  try {
    const runner: Runner = async function* (_p, _d, signal) {
      yield { type: "turn.started" };
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const manager = new SessionManager(dir, runner);
    await manager.load();
    const r = manager.start({ prompt: "test", workingDirectory: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(manager.cancel(r.session.id), true);
    await manager.flush();
    assert.equal(deriveSession(r).status, "cancelled");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("restored incomplete sessions have unknown outcomes instead of claiming live execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  try {
    const manager = new SessionManager(dir, async function* () {
      yield { type: "turn.started" };
      await new Promise(() => {});
    });
    await manager.load();
    const r = manager.start({ prompt: "test", workingDirectory: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await manager.flush();
    const restored = new SessionManager(dir);
    await restored.load();
    assert.equal(deriveSession(restored.get(r.session.id)!).status, "unknown");
    await restored.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("cancel refuses completed turns even while the SDK stream is still cleaning up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  let finish: () => void = () => {};
  try {
    const manager = new SessionManager(dir, async function* () {
      yield { type: "turn.completed" };
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await manager.load();
    const r = manager.start({ prompt: "test", workingDirectory: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(manager.activeCount, 1);
    assert.equal(manager.cancel(r.session.id), false);
    assert.equal(deriveSession(r).status, "completed");
    finish();
    await manager.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("SSE reconnect replays only events after its cursor and closing subscriber does not cancel", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  const manager = new SessionManager(dir, async function* () {
    yield { type: "turn.started" };
    yield { type: "turn.completed" };
  });
  await manager.load();
  const recording = manager.start({ prompt: "test", workingDirectory: dir });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const server = createApi(manager, { port: 4318 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const chunk = await new Promise<string>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}/api/sessions/${recording.session.id}/events?after=0`,
        { headers: { Host: "localhost:4318", "Last-Event-ID": "2" } },
        (res) =>
          res.once("data", (data) => {
            resolve(String(data));
            res.destroy();
            req.destroy();
          }),
      );
      req.on("error", reject);
      req.end();
    });
    assert.ok(chunk.includes("id: 3"));
    assert.ok(chunk.includes("event: reef"));
    assert.ok(!chunk.includes("id: 1"));
    assert.equal(deriveSession(recording).status, "completed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
test("local API blocks cross-origin launch and invalid hosts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reef-test-"));
  const manager = new SessionManager(dir, async function* () {
    yield { type: "turn.completed" };
  });
  await manager.load();
  const server = createApi(manager, { port: 4318 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const hostile = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: {
        Host: "127.0.0.1:4318",
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "run" }),
    });
    assert.equal(hostile.status, 403);
    const badHost = await fetch(`${base}/api/health`);
    assert.equal(badHost.status, 403);
    const good = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${base}/api/health`,
        { headers: { Host: "127.0.0.1:4318" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(good, 200);
    assert.equal(manager.list().length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
