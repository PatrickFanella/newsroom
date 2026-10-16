import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EnrichmentEvidence } from './EnrichmentEvidence';
import { inputEvidence } from '@/lib/enrichment-evidence';
afterEach(cleanup);
it('does not relabel an old summary using a newer basic extraction', () => {
  render(<EnrichmentEvidence summary="Old summary" extraction_evidence={inputEvidence('transcript', 'transcript')} />);
  expect(screen.getByText('Summary input: Input not recorded')).toBeInTheDocument();
});
it('shows the frozen summary input instead of a later extraction', () => {
  render(<EnrichmentEvidence summary="Summary" summary_evidence={inputEvidence('description', 'caption', 'succeeded')} extraction_evidence={inputEvidence('transcript', 'transcript')} />);
  expect(screen.getByText('Summary input: Description or caption only')).toBeInTheDocument();
});
it('explains the limits of provider retrieval and keeps it separate from verification', () => {
  render(<EnrichmentEvidence summary="Summary" summary_evidence={{ ...inputEvidence('page_metadata', 'Description', 'succeeded'), retrieval: 'retrieved', retrieved_url: 'https://example.com/article' }} />);
  expect(screen.getByText(/complete article/)).toBeInTheDocument(); expect(screen.getByText(/does not verify/)).toBeInTheDocument();
  expect(screen.getByRole('link', { hidden: true, name: 'Retrieved page ↗' })).toHaveAttribute('href', 'https://example.com/article');
});
