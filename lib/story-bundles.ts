export const BUNDLE_SOURCE_ROLES = ['coverage', 'primary_document', 'clip'] as const;
export type BundleSource = { title: string; url: string; role: typeof BUNDLE_SOURCE_ROLES[number] };
export type BundleSnapshot = { id: string; title: string; prep_note: string; sources: BundleSource[]; lead_source: { title: string | null; url: string; kind: string }; revision: number };
export type StoryBundle = BundleSnapshot & { stream_id: string; lead_submission_id: string | null; created_at: string; updated_at: string };
export type BundleDetail = { bundle: StoryBundle; lead: { id: string; status: string; title: string | null; url: string; related_coverage?: { title: string; url: string }[] | null } | null };
export const bundleRoleLabel = (role: BundleSource['role']) => ({ coverage: 'Coverage', primary_document: 'Primary document', clip: 'Clip' })[role];
export function validateBundleSettings(body: unknown): { title: string; prep_note: string; sources: BundleSource[]; revision: number } {
  if (!body || typeof body !== 'object') throw new Error('Invalid bundle settings.');
  const value = body as Record<string, unknown>;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 160) throw new Error('Use a title between 1 and 160 characters.');
  if (typeof value.prepNote !== 'string' || value.prepNote.length > 10000) throw new Error('Prep notes must be 10000 characters or fewer.');
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0 || value.revision > 2147483647) throw new Error('Invalid bundle revision.');
  if (!Array.isArray(value.sources) || value.sources.length > 12) throw new Error('Use up to 12 supporting sources.');
  const seen = new Set<string>();
  const sources = value.sources.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid supporting source.');
    const source = raw as Record<string, unknown>;
    if (typeof source.title !== 'string' || !source.title.trim() || source.title.trim().length > 200) throw new Error('Use a source title between 1 and 200 characters.');
    if (!BUNDLE_SOURCE_ROLES.includes(source.role as BundleSource['role'])) throw new Error('Choose a supporting source role.');
    let url: URL;
    try { url = new URL(String(source.url)); } catch { throw new Error('Use a valid supporting source URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('Use an HTTP or HTTPS source URL without credentials.');
    url.hash = '';
    if (seen.has(url.href)) throw new Error('Each supporting source URL must be unique.');
    seen.add(url.href);
    return { title: source.title.trim(), url: url.href, role: source.role as BundleSource['role'] };
  });
  return { title: value.title.trim(), prep_note: value.prepNote.trim(), sources, revision: value.revision };
}
export function bundleMarkdown(bundle: BundleSnapshot) {
  const text = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[\\[\]*_`]/g, '\\$&');
  const url = (s: string) => s.replace(/[()]/g, c => c === '(' ? '%28' : '%29');
  const lines = [`### Story bundle: ${text(bundle.title)}`, ''];
  if (bundle.prep_note) lines.push(bundle.prep_note, '');
  for (const source of bundle.sources) lines.push(`- ${bundleRoleLabel(source.role)}: [${text(source.title)}](${url(source.url)})`);
  return lines.join('\n') + '\n';
}

export function relatedBundleSources(raw: unknown, existing: BundleSource[]): BundleSource[] {
  if (!Array.isArray(raw)) return existing;
  const result = [...existing];
  for (const value of raw) {
    if (result.length >= 12) break;
    if (!value || typeof value !== 'object' || typeof value.url !== 'string') continue;
    try {
      const sources = validateBundleSettings({ title: 'Related coverage', prepNote: '', revision: 0, sources: [...result, { title: (typeof value.title === 'string' ? value.title : value.url).slice(0,200), url: value.url, role: 'coverage' }] }).sources;
      result.splice(0,result.length,...sources);
    } catch { /* Leave unsupported or duplicate suggestions out. */ }
  }
  return result;
}
