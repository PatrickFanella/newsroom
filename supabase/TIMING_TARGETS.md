# Segment timing targets

Shelf segments accept an optional target of 1–1440 whole minutes. Use **Set target for [segment]** to edit it; leave the input blank to clear it. Viewers can read targets, while owners and curator moderators can edit them. A failed save retains the draft.

The shelf shows the sum of assigned targets and the number of timed segments. Untimed segments and ungrouped items are outside that sum, so a partial plan is identified explicitly. Targets describe intended discussion time, not source media runtime or measured airtime.

Template working copies retain targets, including empty segments. Shared shelf imports retain them too. Sending a populated segment or rundown to the deck copies its target into a fresh deck segment and displays it there. The existing send action still skips empty segments.

This follow-up builds on preparation templates. Apply `20261014080000_template_timing_targets.sql` after the template migration and before the app revision. It adds nullable timing fields and updates the template copy function to preserve segment metadata. Existing segments remain untimed. `supabase/tests/template_timing_targets.sql` checks copying and independent edits in a disposable migrated database. Application rollback can retain the additive schema.
