import { resolve } from "node:path";
import { SessionManager } from "./session-manager";
import { createApi } from "./api";
const port = Number(process.env.REEF_PORT ?? 4318);
const manager = new SessionManager(
  resolve(process.env.REEF_DATA_DIR ?? ".reef-data"),
);
await manager.load();
const server = createApi(manager, { port });
server.listen(port, "127.0.0.1", () =>
  console.log(`Reef local API: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close();
    void manager.flush().finally(() => process.exit(0));
  });
