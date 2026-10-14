import { beforeEach,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../queue/route';
const mocks=vi.hoisted(()=>({from:vi.fn(),coverage:vi.fn(),ai:vi.fn()}));
vi.mock('@/lib/session',()=>({getApprovedSession:async()=>({streamId:'channel',role:'streamer',displayName:'Owner'}),getSession:vi.fn(),sessionLogin:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({from:mocks.from})}));
vi.mock('@/lib/curate',()=>({sessionCanCurate:async()=>true}));
vi.mock('@/lib/search-coverage',()=>({searchRelatedCoverage:mocks.coverage}));
vi.mock('@/lib/extract',()=>({runAiEnrichment:mocks.ai}));
vi.mock('@/lib/submit-url',()=>({submitUrlToQueue:vi.fn()}));
vi.mock('@/lib/realtime',()=>({broadcastQueueChange:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
it('rejects approval if the lead has already changed before provider work',async()=>{
  const chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:{status:'played'},error:null})};chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);mocks.from.mockReturnValue(chain);
  const response=await PATCH(new NextRequest('http://localhost/api/queue',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'lead',status:'approved',expectedStatus:'pending'})}));
  expect(response.status).toBe(409);expect(mocks.coverage).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();expect(chain.eq).toHaveBeenCalledWith('stream_id','channel');
});
it('rejects malformed expected statuses without database reads',async()=>{
  const response=await PATCH(new NextRequest('http://localhost/api/queue',{method:'PATCH',body:JSON.stringify({id:'lead',status:'approved',expectedStatus:'invalid'})}));expect(response.status).toBe(400);expect(mocks.from).not.toHaveBeenCalled();
});
