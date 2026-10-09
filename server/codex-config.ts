import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Resolve the same installed native binary used by the official SDK. */
export function resolveCodexExecutable(): string {
  if (process.env.REEF_CODEX_PATH) return process.env.REEF_CODEX_PATH;
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-musl",
    "linux-x64": "x86_64-unknown-linux-musl",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const triple = triples[`${process.platform}-${process.arch}`];
  if (!triple) throw new Error("Unsupported Codex CLI platform");
  const require = createRequire(import.meta.url);
  const codexRequire = createRequire(
    require.resolve("@openai/codex/package.json"),
  );
  const platformName = `@openai/codex-${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
  const root = join(
    dirname(codexRequire.resolve(`${platformName}/package.json`)),
    "vendor",
    triple,
  );
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  for (const directory of ["bin", "codex"]) {
    const path = join(root, directory, name);
    if (existsSync(path)) return path;
  }
  throw new Error(
    "Cannot locate SDK Codex CLI binary. Install optional dependencies or set REEF_CODEX_PATH.",
  );
}

/** Keep only server names. Never log, record, or return transports or auth values. */
export function isolationOverrides(metadataJson: string): string[] {
  const metadata: unknown = JSON.parse(metadataJson);
  if (!Array.isArray(metadata))
    throw new Error("Unexpected MCP metadata format");
  const names = metadata.map((server) => {
    if (
      !server ||
      typeof server !== "object" ||
      typeof server.name !== "string" ||
      !server.name.length
    )
      throw new Error("Invalid MCP server metadata");
    // Dotted CLI keys do not support quoted path segments in the SDK/CLI.
    if (!/^[a-zA-Z0-9_-]+$/.test(server.name))
      throw new Error(
        "Cannot safely disable an MCP server with an unsupported name",
      );
    return server.name as string;
  });
  return [
    "features.plugins=false",
    "features.apps=false",
    ...new Set(names.map((name) => `mcp_servers.${name}.enabled=false`)),
  ];
}

export async function getIsolationOverrides(
  executable: string,
  workingDirectory: string,
  signal: AbortSignal,
): Promise<string[]> {
  if (process.env.REEF_INHERIT_TOOLS === "1") return [];
  try {
    // Enumerate with plugins already disabled. Plugin-provided names disappear
    // with their transports; adding standalone overrides would create invalid entries.
    const { stdout } = await execute(
      executable,
      [
        "-c",
        "features.plugins=false",
        "-c",
        "features.apps=false",
        "mcp",
        "list",
        "--json",
      ],
      {
        cwd: workingDirectory,
        timeout: 15_000,
        maxBuffer: 4_000_000,
        signal,
        encoding: "utf8",
      },
    );
    return isolationOverrides(stdout);
  } catch {
    // Child-process errors can carry complete stdout/stderr including private config.
    throw new Error(
      "Could not isolate inherited Codex integrations. Launch stopped before the task ran. Check CLI availability, or deliberately set REEF_INHERIT_TOOLS=1 to use inherited tools.",
    );
  }
}
