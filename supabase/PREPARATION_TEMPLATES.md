# Reusable show preparation

Open a shelf and choose **Edit preparation settings**. Enable **Reuse this shelf as a preparation template** and add prep prompts, such as source checks, interview questions, or a research checklist. Save the settings. Existing shelf segments, standard links, and item notes form the template's content; empty segments can reserve space for research you will add later.

Enter a **Working shelf name**, then choose **Create working shelf**. Follow **Open working shelf** to prepare that show's rundown. The copy has fresh shelf, segment, and item IDs. It retains segment positions, the ungrouped bucket's position, snapshotted link metadata, item notes, and prep prompts. It starts as an ordinary private shelf with no share token. Editing or deleting either shelf does not change the other. Each successful creation makes another independent copy; it does not replace an existing working shelf.

Use the working shelf's existing **Send rundown to deck** action when preparation is ready. That action copies populated segments and skips URLs already on the approved deck. Empty segments remain on the working shelf until you fill them. Prep prompts remain on the shelf; item notes copy into the deck's prep notes. Template creation does not start a broadcast, refresh source metadata, or call an AI provider. Timing targets are outside this feature.

Stream owners and moderators with curator permission can change preparation settings and create working copies. Other signed-in members can read the shelf and its prompts. Prep prompts and template status are not included in public shared-shelf views or shared-shelf imports.

## Migration and verification

Apply `20261014060000_preparation_templates.sql` before deploying this app revision. It adds two fields to `lists` and a service-role-only copy function. Existing shelves default to ordinary shelves with empty prompts. The API uses the session's stream ID and checks curator permission before calling the function; the function independently requires an owned template. It captures the source shelf and its children in one database snapshot and inserts the copy in one transaction. An insertion failure rolls back the copy.

Run `npm test` with Node 24.18.0 for validation and UI tests. In a disposable database with the migrations and Supabase roles installed, run:

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/preparation_templates.sql
```

The SQL contract checks stream isolation, function access, empty segments, metadata and note retention, fresh IDs, source deletion, invalid names, and rollback after a child-insert failure. Its fixtures roll back.

For an application rollback, deploy the previous app revision and retain the additive schema and prepared shelves. Removing the columns would discard template settings and prep prompts; it is not needed to run the previous revision.
