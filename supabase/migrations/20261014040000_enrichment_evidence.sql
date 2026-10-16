-- Separate latest basic extraction from the input used for AI analysis, so
-- a late basic fetch cannot relabel a generated summary. Historical rows
-- intentionally remain null: their inputs cannot be reconstructed reliably.
alter table public.submissions
  add column extraction_evidence jsonb,
  add column summary_evidence jsonb;
