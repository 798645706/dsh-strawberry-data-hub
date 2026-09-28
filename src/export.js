import { createHash, randomUUID } from 'node:crypto';
import { checkSequences } from './client.js';

export function buildFasta(result, args) {
  checkSequences(result, args);
  const entries = result.sequences.filter(e => e.available);
  if (!entries.length) throw new Error(`SDH_NO_SEQUENCE: ${result.status ?? 'unavailable'}; no file created.`);
  const records = entries.map(entry => {
    const header = entry.fastaHeader;
    if (typeof header !== 'string' || !header.startsWith('>') || /[\r\n\x00-\x1f]/.test(header)) throw new Error('SDH_SEQUENCE_INTEGRITY: Invalid FASTA header.');
    const expected = `>${args.gene_id}|species=${args.species}|assembly=${args.version}|type=${entry.type.toLowerCase()}`;
    if (header !== expected) throw new Error('SDH_SCOPE_MISMATCH: FASTA header does not match the requested key.');
    return `${header}\n${entry.sequence.match(/.{1,80}/g).join('\n')}\n`;
  });
  const content = records.join('');
  return { content, fileSha256: createHash('sha256').update(content, 'utf8').digest('hex'), bytes: Buffer.byteLength(content) };
}

export async function exportFasta(value, args, exec) {
  const agent = exec.agent;
  const cwd = agent?.session?.header?.cwd;
  const fs = agent?.ctx?.get('fs');
  const projections = agent?.ctx?.get('sessionProjections');
  const boundary = projections?.stateOf(agent.session, 'turnBoundary');
  if (!cwd || !fs || boundary?.openTurnStartSeq == null) throw new Error('SDH_EXPORT_UNAVAILABLE: Requires an active DSH workspace turn with filesystem and deliverables support.');
  const policyService = agent.ctx.get('sandboxPolicy');
  if (fs.sandboxMode !== undefined && !policyService) throw new Error('SDH_EXPORT_UNAVAILABLE: Missing filesystem sandbox policy.');
  const policy = policyService?.resolve({ session: agent.session });
  const file = buildFasta(value.result, args);
  const filename = `sdh-${args.gene_id.replace(/[^A-Za-z0-9._-]/g, '_')}-${randomUUID()}.fasta`;
  const root = await fs.resolve(cwd, { signal: exec.signal });
  const target = await fs.resolve(filename, { cwd, signal: exec.signal });
  if (!fs.contains(root, target)) throw new Error('SDH_EXPORT_PATH: Target is outside the workspace.');
  await fs.writeText(target, file.content, { kind: 'createIfAbsent' }, exec.signal, policy);
  const saved = await fs.readBytes(target, exec.signal, 2 * 1024 * 1024);
  if (createHash('sha256').update(saved).digest('hex') !== file.fileSha256) throw new Error('SDH_FILE_INTEGRITY: Saved file differs from verified FASTA; it was not presented.');
  exec.signal.throwIfAborted();
  const webServer = agent.ctx.get('webServer');
  const downloadPath = `/api/file?path=${encodeURIComponent(target.displayPath)}`;
  const downloadUrl = webServer?.host === '127.0.0.1' && Number.isInteger(webServer.port)
    ? `http://127.0.0.1:${webServer.port}${downloadPath}` : downloadPath;
  return {
    delivery: { session: agent.session, turn: boundary.lastTurn, files: [{ path: target.displayPath, description: `Verified SDH FASTA: ${args.gene_id}` }] },
    result: { ...value, result: { ...value.result, sequences: value.result.sequences.map(({ sequence, ...entry }) => ({ ...entry, sequenceOmittedFromModel: typeof sequence === 'string' })) },
      file: { path: target.displayPath, downloadUrl, fileSha256: file.fileSha256, bytes: saved.length, verified: true, format: 'FASTA', created: true },
      deliveryNotice: 'File bytes were verified after writing by this local plugin, using the original server sequence. This tool publishes its own DSH deliverable on success; do not call present again. In the Web UI include a Markdown download link using file.downloadUrl. Source files remain editable. Do not reconstruct sequences from metadata.' },
  };
}

export function renderResult(value) {
  if (value.tool === 'sequence_fetch') {
    const compact = { ...value, result: { ...value.result, sequences: value.result.sequences.map(({ sequence, ...entry }) => ({ ...entry, sequenceOmittedFromModel: true })) } };
    return [{ type: 'text', text: JSON.stringify(compact) + (value.file ? '\nExport completed; do not repeat export or present. Use the provided downloadUrl for the download link.' : '\nUse sdh_sequence_export when the user requests a FASTA download. Sequence text is intentionally omitted from model context; never reconstruct it.') }];
  }
  return [{ type: 'text', text: JSON.stringify(value) }];
}
