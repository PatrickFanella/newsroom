import { evidenceLabel, type EnrichmentEvidence as Evidence } from '@/lib/enrichment-evidence';

export function EnrichmentEvidence({ summary, extraction_evidence, summary_evidence }: {
  summary?: string | null; extraction_evidence?: Evidence | null; summary_evidence?: Evidence | null;
}) {
  const evidence = summary ? summary_evidence : summary_evidence ?? extraction_evidence;
  if (!summary && !evidence) return null;
  const recorded = evidence?.version === 1;
  let retrievedUrl: string | null = null;
  try {
    const url = new URL(evidence?.retrieved_url ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password) retrievedUrl = url.toString();
  } catch {}
  return <details className="border-t border-ink/20 pt-2 mt-2 text-xs">
    <summary className="font-mono cursor-pointer text-ink/70">{summary ? 'Summary input' : 'Enrichment input'}: {evidenceLabel(evidence)}</summary>
    <div className="space-y-2 text-ink/65 mt-2">
      {!recorded ? <p>The input used for this summary was not recorded.</p> : <>
        <p>{({ metadata_only: 'Metadata extraction recorded.', succeeded: 'AI response accepted.', skipped: 'AI analysis skipped.', failed: 'Extraction or analysis failed.', refused: 'AI analysis was refused.', invalid_response: 'AI response could not be read.' } as const)[evidence.outcome]}</p>
        {evidence.source === 'transcript' && <p>The supplied text included a transcript excerpt. The video itself was not watched.</p>}
        {evidence.source === 'description' && <p>The supplied text was a description or caption, rather than a transcript or full article.</p>}
        {evidence.source === 'page_metadata' && evidence.retrieval !== 'retrieved' && <p>Only page metadata was available locally. A successful provider page fetch was not observed.</p>}
        {evidence.retrieval === 'failed' && <p>The provider reported that its page fetch failed.</p>}
        {evidence.retrieval === 'retrieved' && <p>The provider returned a page-fetch result. This does not establish that the complete article was available.</p>}
        {retrievedUrl && <a className="underline break-all block" href={retrievedUrl} target="_blank" rel="noreferrer">Retrieved page ↗</a>}
        <p>Supplied excerpt: {evidence.input_characters} characters{evidence.model ? ` · Model: ${evidence.model}` : ''}</p>
        <p>Recorded {new Date(evidence.checked_at).toLocaleString()}</p>
      </>}
      <p>Input provenance does not verify the story’s factual claims. Publisher categories and copyright/content flags are estimates.</p>
    </div>
  </details>;
}
