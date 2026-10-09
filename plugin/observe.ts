import { recordNativeHook } from "./native";
// Hooks must finish quickly and never interfere with the native Codex task.
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 65_536) {
      input = "";
      break;
    }
  }
  if (input) await recordNativeHook(JSON.parse(input));
} catch {
  /* Observation is best-effort; no hook payload or configuration is logged. */
}
process.stdout.write("{}\n");
