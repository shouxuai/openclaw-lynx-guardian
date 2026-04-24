import { createLocalConsoleApp } from "./app.js";
import { resolveBackendConfig } from "./config/env.js";

const config = resolveBackendConfig();
const app = await createLocalConsoleApp(config);

try {
  await app.listen({
    host: config.listenHost,
    port: config.port,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
