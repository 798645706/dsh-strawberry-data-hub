// Derived summaries never modify the provenance-covered server result.
export function metaboliteMetrics(result, args) {
  if (!Array.isArray(result.features)) return undefined;
  const groups = new Map();
  let missing = 0;
  for (const feature of result.features) {
    const name = feature?.originalName;
    if (typeof name !== 'string' || !name.length) { missing++; continue; }
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(typeof feature.id === 'string' ? feature.id : null);
  }
  const query = typeof args.query === 'string' ? args.query : null;
  return {
    returnedFeatureCount: result.features.length, missingOriginalNameCount: missing,
    originalNameGroups: [...groups].map(([originalName, featureIds]) => ({ originalName, count: featureIds.length, featureIds })),
    query, exactQueryMatchCount: query === null ? null : (groups.get(query)?.length ?? 0),
    caseInsensitiveQueryMatchCount: query === null ? null : [...groups].reduce((sum, [name, ids]) => sum + (name.toLowerCase() === query.toLowerCase() ? ids.length : 0), 0),
    meaning: 'Program-computed counts of returned feature ROWS only, not unique compounds or database totals. originalNameGroups uses originalName exactly, including case and whitespace; never substitute normalized name. For exact Sucrose use that exact group, even when query is lowercase sucrose. Case-insensitive equality only changes letter case; derivatives remain separate. Missing originalName is not inferred from name. Copy these counts and group membership rather than counting manually.',
  };
}

export function referenceMetrics(name, result, args) {
  if (name !== 'genome_evidence_query' || args.operation !== 'assemblies' || !Array.isArray(result.data?.items)) return undefined;
  const d = result.data;
  return {
    catalogue: 'genome_evidence_query:assemblies', returnedRowCount: d.items.length,
    matchingTotal: Number.isSafeInteger(d.total) && d.total >= 0 ? d.total : null,
    truncated: typeof d.truncated === 'boolean' ? d.truncated : null,
    references: d.items.map(row => ({ assemblyId: row.assemblyId, releaseId: row.releaseId, label: row.label })),
    meaning: 'Counts belong only to this catalogue and query. Use this reference list as the single list for genome-browser reference selection; retain exact IDs and labels. Other catalogues may describe the same assemblies: never add their row counts or call extra rows additional genomes. No cross-catalogue deduplication has been performed. primary is a primary assembly, not another haplotype; hap1/hap2 are separately labelled representations. Report returned rows separately from matchingTotal when paginated.',
  };
}
