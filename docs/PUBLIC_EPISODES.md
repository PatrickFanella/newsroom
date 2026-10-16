# Public episode pages

On an ended show's detail page, set a public title under **Public episode page**. Summaries and personal takeaways are excluded by default; enable either explicitly if you want that text published. Choose **Preview public episode**, inspect the exact page content, then **Publish this preview**. The public URL works without a session and contains the covered-story links and recording chapters.

Publication saves a separate projection. Internal broadcast/queue IDs, the saved rundown, preparation notes, moderation fields, source bodies, and review tokens are excluded. Source links refuse unsafe protocols or embedded credentials and remove YouTube playlist sharing parameters. Public reads also select and reconstruct only the public schema. This prevents extra stored keys from reaching the public API.

Source edits do not change an already published episode. Preview and republish to replace its snapshot at the same public URL. If the previewed content changes before publishing, the API asks for a new preview. **Revoke public episode** removes the token and snapshot; publishing again generates a new token, so the old URL stays revoked. Public responses use no shared cache. Existing distributed copies of previously public text are not changed by revocation.

Only the owner can preview, publish, or revoke; moderators cannot. No episode is published automatically. Apply `20261014130000_public_episode_pages.sql` before app deployment. SQL tests verify ownership, stable republish URLs, revocation and new tokens. Projection tests verify explicit text opt-ins, private-field exclusion, unsafe-link refusal and allowlisted public reads. Application rollback can retain the schema, but the older app has no public-page renderer.
