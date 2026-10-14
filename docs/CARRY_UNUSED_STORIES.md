# Carry unused stories into preparation

On an ended show, enter a **Working shelf name** under **Carry unused stories forward**, then choose **Prepare next show shelf**. The server copies saved rundown items with no uncancelled recorded play in that show into an independent shelf. This means unused in that specific historical show; a story played in a later show can still qualify when you revisit the older one.

The shelf preserves the saved segment structure and ungrouped position, including empty segments. It keeps saved titles/URLs and available current metadata and prep notes from surviving queue rows. Deleted unused rows fall back to the show-start snapshot; their URLs are normalized on the server. A played story remains excluded after its queue row is deleted because the persisted note URL still identifies it. The live deck and historical show remain intact. No provider refresh is performed.

The first successful copy is recorded for that show. Retrying returns the same shelf, even if you supply a different name; the operation does not create duplicates. If that working shelf has been deleted, the receipt reports that explicitly instead of silently recreating it. A show with no unused stories creates no shelf. Only the stream owner can perform the action.

This builds on broadcast sessions. Apply `20261014120000_carry_unused_stories.sql` before app deployment. The function locks the stream, determines unused stories from one database snapshot, and inserts the shelf, segments, items and receipt in one transaction. The SQL contract verifies cleanup-safe exclusion, metadata retention, normalized deleted snapshots, fresh segment IDs, independent deck state, retry behavior and stream isolation. Application rollback can retain prepared shelves and receipts.
