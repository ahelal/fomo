import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const catalog = [];
for (const id of ['anthropic', 'copilot-cli', 'teams-meetings']) {
  const directory = new URL(`./dist/${id}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [new URL(`./src/${id}/index.ts`, import.meta.url).pathname],
    outfile: new URL('index.mjs', directory).pathname,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', sourcemap: false,
  });
  const manifest = await readFile(new URL(`./src/${id}/extension.json`, import.meta.url));
  await writeFile(new URL('extension.json', directory), manifest);
  const hashes = {};
  for (const file of ['extension.json', 'index.mjs']) {
    hashes[file] = createHash('sha256').update(await readFile(new URL(file, directory))).digest('hex');
  }
  catalog.push({ id, hashes });
}
await writeFile(new URL('./dist/catalog.json', import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`);
