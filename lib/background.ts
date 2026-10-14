import { after } from 'next/server';

// Next.js retains after() work on both Vercel and a standalone Node server,
// and drains it on graceful shutdown. Promises are already running here.
export function waitUntil(work: Promise<unknown>): void {
  const settled = work.catch(() => { console.error('Background operation failed.'); });
  try { after(() => settled); }
  catch {
    // Scripts/tests outside a request have no Next.js lifecycle. The running
    // promise still settles in the persistent process and logs failures.
    void settled;
  }
}
