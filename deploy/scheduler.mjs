// Replaces Vercel Cron with the same authenticated daily HTTP contract.
import { writeFileSync } from 'node:fs';
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error('CRON_SECRET is required');
const url = process.env.CLEANUP_URL || 'http://app:3000/api/cron/cleanup';
async function cleanup() {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000), redirect: 'error' });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error('Cleanup request failed');
  console.log('Daily cleanup completed.');
}
if (process.argv.includes('--once')) await cleanup();
else {
  const heartbeat = () => writeFileSync('/tmp/newsroom-scheduler-health', String(Date.now()), { mode: 0o600 });
  heartbeat();
  const healthTimer = setInterval(heartbeat, 30_000);
  let timer;
  const schedule = () => {
    const next = new Date(); next.setUTCHours(9, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    timer = setTimeout(async () => {
      try { await cleanup(); } catch { console.error('Daily cleanup failed; inspect application logs.'); }
      schedule();
    }, next.getTime() - Date.now());
  };
  schedule();
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { clearTimeout(timer); clearInterval(healthTimer); process.exit(0); });
}
