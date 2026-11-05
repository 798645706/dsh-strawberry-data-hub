// Run with the desktop's Electron executable in ELECTRON_RUN_AS_NODE mode.
// Uses the installed host packages, an isolated directory and a fixture HTTP server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../src/index.js';

const packageRoot = process.argv[2];
if (!packageRoot) throw Error('Pass the installed desktop @deepseek-ai package directory.');
async function host(name) {
  const directory = join(packageRoot, name);
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  return import(pathToFileURL(join(directory, metadata.main)).href);
}
const { Context } = await host('cordis');
const { default: ToolRuntime } = await host('dsh-tools');
const { default: SystemPrompt } = await host('dsh-system-prompt');
const { default: FileSystem } = await host('dsh-fs-sandbox');
const cwd = await mkdtemp(join(tmpdir(), 'sdh-desktop-'));
const current = join(cwd, 'current');
await mkdir(current);
const args = { gene_id: 'gene.1', species: 'Fragaria vesca', version: 'v6', type: 'protein' };
const sequence = 'MAL*';
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ tool: 'sequence_fetch', status: 'ok', result: { status: 'ok',
    gene: { geneId: args.gene_id, species: args.species, version: args.version }, sequences: [{
      type: 'protein', available: true, sequence, length: sequence.length,
      sha256: createHash('sha256').update(sequence).digest('hex'),
      fastaHeader: '>gene.1|species=Fragaria vesca|assembly=v6|type=protein',
    }] } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const ctx = new Context();
const presented = [];
let mode = 'workspace-write';
try {
  ctx.provide('sandboxPolicy', { defaultMode: mode, resolve: () => ({ mode, workspaceRoot: cwd }) });
  ctx.provide('sessionProjections', { stateOf: () => ({ openTurnStartSeq: 1, lastTurn: 1 }) });
  ctx.provide('workingDirectory', { ensure: async () => current });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(FileSystem, { cwd });
  await ctx.plugin(plugin, { baseUrl: `http://127.0.0.1:${server.address().port}/` });
  assert.equal(ctx.tools.schemas().filter(t => t.name.startsWith('sdh_')).length, 37);
  const agent = { ctx, session: { header: { cwd }, append: (type, data) => presented.push({ type, data }) } };
  const run = () => ctx.tools.execute({ callId: 'desktop-export', name: 'sdh_sequence_export', arguments: args,
    agent, signal: new AbortController().signal });
  const response = await run();
  assert.equal(response.isError, false, JSON.stringify(response));
  const value = JSON.parse(response.content[0].text.split('\n')[0]);
  assert.equal(presented.length, 1);
  assert.equal(presented[0].type, 'deliverables/presented');
  assert.equal(presented[0].data.files[0].path, value.file.path);
  assert.equal(join(value.file.path, '..'), current);
  const bytes = await readFile(value.file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), value.file.fileSha256);
  const downloaded = Buffer.from(await (await fetch(value.file.downloadUrl)).arrayBuffer());
  assert.deepEqual(downloaded, bytes);
  mode = 'read-only';
  assert.equal((await run()).isError, true);
  assert.equal(presented.length, 1);
  console.log(JSON.stringify({ passed: true, tools: 37, directory: current, bytes: bytes.length,
    checks: ['host runtime', 'current directory', 'native sandbox write', 'checksum download', 'native attachment event', 'read-only denial'] }));
} finally {
  ctx.registry.delete(plugin);
  ctx.registry.delete(FileSystem);
  ctx.registry.delete(ToolRuntime);
  ctx.registry.delete(SystemPrompt);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
