import { mkdtempSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let root = projectRoot;
let temporaryDirectory;

// Vite rejects colons in served file paths; keep its filesystem guard enabled.
if (process.platform !== 'win32' && projectRoot.includes(':')) {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'motion-garden-vite-'));
  root = join(temporaryDirectory, 'game');
  symlinkSync(projectRoot, root, 'dir');
}

const cleanup = () => {
  if (!temporaryDirectory) return;
  unlinkSync(root);
  rmdirSync(temporaryDirectory);
  temporaryDirectory = undefined;
};
process.on('exit', cleanup);
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const { createServer } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  resolve: { preserveSymlinks: true },
  server: {
    host: '127.0.0.1',
    port: portIndex >= 0 ? Number(args[portIndex + 1]) : 5173,
    strictPort: args.includes('--strictPort'),
    fs: { strict: true, allow: [root] },
  },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
