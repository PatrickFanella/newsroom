import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { enrichContent } from './enrich';
import { pageText } from './enrich-compatible';

const mocks=vi.hoisted(()=>({reserve:vi.fn(),finish:vi.fn(),page:vi.fn(),anthropic:vi.fn()}));
vi.mock('./usage-budget',()=>({reservePaidUsage:mocks.reserve,finishPaidUsage:mocks.finish}));
vi.mock('./safe-fetch',()=>({safeFetchText:mocks.page}));
vi.mock('@anthropic-ai/sdk',()=>({default:class{constructor(){mocks.anthropic();}}}));
const input={url:'https://example.invalid/video',title:'Fixture story',publisher:'Example',body:'Source description',kind:'youtube',streamId:'owner-channel'};
const summary={summary:'Summary from supplied source',topics:['fixture',99],credibility:'unknown',dmca_risk:'low',content_warning:false};
const response=(content:unknown=JSON.stringify(summary),finish_reason='stop')=>new Response(JSON.stringify({choices:[{message:{content},finish_reason}],usage:{prompt_tokens:12,completion_tokens:24}}));
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('AI_PROVIDER','openai-compatible');vi.stubEnv('OPENAI_BASE_URL','https://gateway.example.invalid/v1');vi.stubEnv('OPENAI_MODEL','fixture-model');vi.stubEnv('OPENAI_API_KEY','');vi.stubEnv('OPENAI_MAX_TOKENS_FIELD','');
  mocks.reserve.mockResolvedValue('receipt');mocks.finish.mockResolvedValue(undefined);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('OpenAI-compatible enrichment',()=>{
  it('uses the configured model/endpoint without constructing a Claude client',async()=>{
    const fetchMock=vi.fn(async()=>response());vi.stubGlobal('fetch',fetchMock);
    const result=await enrichContent(input);
    expect(result).toMatchObject({summary:summary.summary,topics:['fixture'],evidence:{model:'fixture-model',outcome:'succeeded'}});
    expect(mocks.anthropic).not.toHaveBeenCalled();
    const [url,options]=fetchMock.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://gateway.example.invalid/v1/chat/completions');expect(options.redirect).toBe('error');expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(options.body))).toMatchObject({model:'fixture-model',max_completion_tokens:800,stream:false});
    expect(mocks.reserve).toHaveBeenCalledWith('owner-channel','ai_enrich',1,expect.objectContaining({provider:'openai-compatible'}));
    expect(mocks.finish).toHaveBeenCalledWith('receipt',expect.objectContaining({outcome:'succeeded',input_tokens:12,output_tokens:24}));
  });
  it('completes an actual HTTP round trip to a keyless local compatible server',async()=>{
    let received:{path?:string;authorization?:string;body?:unknown}={};
    const server=createServer(async(request,response)=>{
      const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
      received={path:request.url,authorization:request.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())};
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(summary)},finish_reason:'stop'}]}));
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const address=server.address();if(!address || typeof address==='string')throw new Error('No fixture port');
      vi.stubEnv('OPENAI_BASE_URL',`http://127.0.0.1:${address.port}/fixture/v1`);
      const result=await enrichContent(input);
      expect(result.summary).toBe(summary.summary);expect(received.path).toBe('/fixture/v1/chat/completions');expect(received.authorization).toBeUndefined();expect(received.body).toMatchObject({model:'fixture-model',max_completion_tokens:800});
    }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error ? reject(error) : resolve()));}
  });
  it('sends a configured key only to the configured endpoint',async()=>{
    vi.stubEnv('OPENAI_API_KEY','fixture-key');const request=vi.fn(async()=>response());vi.stubGlobal('fetch',request);await enrichContent(input);
    expect((request.mock.calls[0] as unknown as [string,RequestInit])[1].headers).toMatchObject({Authorization:'Bearer fixture-key'});
  });
  it('never dispatches after allowance denial',async()=>{
    mocks.reserve.mockResolvedValue(null);const request=vi.fn();vi.stubGlobal('fetch',request);expect((await enrichContent(input)).skippedReason).toContain('usage');expect(request).not.toHaveBeenCalled();expect(mocks.finish).not.toHaveBeenCalled();
  });
  it('fails closed on configuration errors instead of falling back to Claude',async()=>{
    vi.stubEnv('OPENAI_MODEL','');const request=vi.fn();vi.stubGlobal('fetch',request);expect((await enrichContent(input)).failureReason).toContain('configuration');expect(request).not.toHaveBeenCalled();expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.anthropic).not.toHaveBeenCalled();
  });
  it('fetches bounded page text and labels server retrieval separately from provider browsing',async()=>{
    mocks.page.mockResolvedValue({text:'<article><p>Source article text.</p><script>private script</script></article>',status:200,url:'https://example.invalid/article'});
    const request=vi.fn(async()=>response());vi.stubGlobal('fetch',request);const result=await enrichContent({...input,kind:'article'});
    expect(mocks.page).toHaveBeenCalledWith(input.url,expect.objectContaining({timeoutMs:8000,maxBytes:2097152}));
    expect(result.evidence).toMatchObject({source:'page_text',retrieval:'retrieved',input_characters:20});
    const body=JSON.parse(String((request.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.messages[1].content).toContain('Source article text.');expect(body.messages[1].content).not.toContain('private script');expect(body.messages[0].content).toContain('There are no browsing tools');expect(body).not.toHaveProperty('tools');
  });
  it('does not pay for or invent an article summary when extraction fails',async()=>{
    mocks.page.mockRejectedValue(new Error('blocked'));const request=vi.fn();vi.stubGlobal('fetch',request);const result=await enrichContent({...input,kind:'article'});expect(result.failureReason).toContain('could not be read');expect(result.evidence?.retrieval).toBe('failed');expect(mocks.reserve).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
  });
  it.each([null,'not json','{"summary":null}','{"summary":" "}'])('records invalid output without dispatching retries: %s',async content=>{
    const request=vi.fn(async()=>response(content));vi.stubGlobal('fetch',request);expect((await enrichContent(input)).evidence?.outcome).toBe('invalid_response');expect(request).toHaveBeenCalledTimes(1);expect(mocks.finish).toHaveBeenCalledWith('receipt',expect.objectContaining({outcome:'invalid_response'}));
  });
  it('records refusals and truncation honestly',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response(null,'content_filter')));expect((await enrichContent(input)).evidence?.outcome).toBe('refused');
    vi.stubGlobal('fetch',vi.fn(async()=>response(JSON.stringify(summary),'length')));expect((await enrichContent(input)).evidence?.outcome).toBe('invalid_response');
  });
  it('counts failed HTTP attempts once and does not expose provider errors',async()=>{
    const request=vi.fn(async()=>new Response('private provider error',{status:401}));vi.stubGlobal('fetch',request);const result=await enrichContent(input);expect(result.evidence?.outcome).toBe('failed');expect(JSON.stringify(result)).not.toContain('private');expect(request).toHaveBeenCalledTimes(1);expect(mocks.finish).toHaveBeenCalledWith('receipt',expect.objectContaining({outcome:'failed'}));
  });
  it('caps provider output before parsing',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(1024*1024+1))));expect((await enrichContent(input)).evidence?.outcome).toBe('failed');
  });
  it('prefers article/main text, strips active content, and bounds input length',()=>{
    expect(pageText('<nav>Menu</nav><main>Source <style>hidden</style>text &amp; entities</main>')).toBe('Source text & entities');expect(pageText('x'.repeat(9000))).toHaveLength(5500);
  });
});
