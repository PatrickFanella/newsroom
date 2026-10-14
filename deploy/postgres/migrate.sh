#!/bin/sh
set -eu
# One connection holds the advisory lock across all transactions. Old file
# hashes must match the ledger; upgrades never silently rewrite migrations.
{
  printf '%s\n' "SELECT pg_advisory_lock(728493105);" \
    "CREATE TABLE IF NOT EXISTS public.newsroom_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());"
  for file in /migrations/*.sql; do
    name=$(basename "$file")
    case "$name" in *[!a-zA-Z0-9_.]*) echo 'Invalid migration filename' >&2; exit 1;; esac
    checksum=$(sha256sum "$file" | cut -d ' ' -f 1)
    printf "SELECT EXISTS(SELECT 1 FROM public.newsroom_migrations WHERE version='%s' AND checksum<>'%s') AS mismatch \\gset\n" "$name" "$checksum"
    printf '%s\n' '\if :mismatch' '\echo Previously applied migration changed; restore its original file.' 'DO $$ BEGIN RAISE EXCEPTION '\''Previously applied migration changed'\''; END $$;' '\endif'
    printf "SELECT EXISTS(SELECT 1 FROM public.newsroom_migrations WHERE version='%s') AS applied \\gset\n" "$name"
    printf '%s\n' '\if :applied' '\else' 'BEGIN;'
    printf '\\i %s\n' "$file"
    printf "INSERT INTO public.newsroom_migrations(version,checksum) VALUES('%s','%s');\n" "$name" "$checksum"
    printf '%s\n' 'COMMIT;' '\endif'
  done
  printf '%s\n' 'GRANT USAGE ON SCHEMA public TO service_role;' 'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;' 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;'
} | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
