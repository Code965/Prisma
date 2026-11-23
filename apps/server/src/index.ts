import { isAbsolute, resolve } from 'node:path';
import { loadDotEnv, parseEnv, repoRoot } from './config/env.js';
import { createPrismaRuntime } from './runtime.js';

/**
 * Server da solo (sviluppo, o un PC/VPS sempre acceso): apre la porta HTTP. L'app desktop invece
 * fa girare lo stesso runtime al suo interno (vedi apps/desktop/src/main/core.ts).
 */
async function main(): Promise<void> {
  loadDotEnv();
  const parsed = parseEnv(process.env);
  // Un percorso relativo del database parte dalla radice del progetto, non dalla cartella corrente.
  const env = {
    ...parsed,
    DATABASE_PATH: isAbsolute(parsed.DATABASE_PATH)
      ? parsed.DATABASE_PATH
      : resolve(repoRoot(), parsed.DATABASE_PATH),
  };
  const runtime = await createPrismaRuntime(env);

  const shutdown = async (signal: string) => {
    runtime.app.log.info({ signal }, 'Arresto in corso');
    await runtime.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await runtime.app.listen({ port: env.PORT, host: env.HOST });
  runtime.startBackground();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
