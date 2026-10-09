import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';

test('registers 31 tools in real Cordis/DSH runtime and executes through its pipeline', { timeout: 10000 }, async () => {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/strawberry/api/v1/ai/agent/tools/gene_resolve');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tool: 'gene_resolve', status: 'ok', result: { status: 'ambiguous', candidates: [] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(plugin, { baseUrl: `http://127.0.0.1:${server.address().port}/strawberry/`, researchOnly: true });
    const assembly = await ctx.systemPrompt.assemble();
    assert.equal(assembly.sections.filter(s => s.name === 'strawberry-data-hub:scientific-evidence').length, 1);
    assert.match(assembly.sections.find(s => s.name === 'strawberry-data-hub:scientific-evidence').text, /missing evidence from evidence of absence/);
    let shellRan = false;
    ctx.tools.register(defineTool({ name: 'pwsh', description: 'Test fixture, never executes a shell', parameters: {},
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute() { shellRan = true; return 'unexpected'; } }));
    const denied = await ctx.tools.execute({ callId: 'deny-shell', name: 'pwsh', arguments: {}, signal: new AbortController().signal });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied.content), /SDH_RESEARCH_ONLY/);
    assert.equal(shellRan, false);
    assert.equal(ctx.tools.schemas().filter(x => x.name.startsWith('sdh_')).length, 31);
    const result = await ctx.tools.execute({ callId: 'sdh-test', name: 'sdh_gene_resolve',
      arguments: { gene_id: 'test' }, signal: new AbortController().signal });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = JSON.parse(result.content[0].text);
    assert.equal(value.result.status, 'ambiguous');
    assert.equal(value.answerReviewed, false);
    const invalid = await ctx.tools.execute({ callId: 'sdh-invalid', name: 'sdh_gene_context',
      arguments: { gene_id: 'test' }, signal: new AbortController().signal });
    assert.equal(invalid.isError, true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    ctx.registry.delete(plugin);
    ctx.registry.delete(ToolRuntime);
    ctx.registry.delete(SystemPrompt);
  }
});
