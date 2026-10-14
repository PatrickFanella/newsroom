import { afterEach, expect, it, vi } from 'vitest';
import { waitUntil } from './background';
const retain=vi.hoisted(()=>vi.fn());
vi.mock('next/server',()=>({after:retain}));
afterEach(()=>{vi.clearAllMocks();vi.restoreAllMocks();});
it('retains background work using the portable Next.js lifecycle',async()=>{
 const work=Promise.resolve();waitUntil(work);expect(retain).toHaveBeenCalledOnce();await expect(retain.mock.calls[0][0]()).resolves.toBeUndefined();
});
it('contains rejected work without logging sensitive errors',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});waitUntil(Promise.reject(new Error('private token')));await retain.mock.calls[0][0]();expect(log).toHaveBeenCalledWith('Background operation failed.');
});
