import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { BundleView } from './BundleView';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
const initial={bundle:{id:'bundle',title:'Budget story',prep_note:'Prep',sources:[],revision:0,lead_source:{title:'Lead',url:'https://example.com/lead',kind:'article'}},lead:{id:'lead',status:'pending',title:'Lead',url:'https://example.com/lead'}};
function setup(canManage=true,conflict=false){
  let detail=structuredClone(initial);const writes:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{
    if(init?.method==='PATCH'){
      const body=JSON.parse(String(init.body));writes.push(body);
      if(conflict){detail={...detail,bundle:{...detail.bundle,title:'Newer title',revision:1}};return Response.json({error:'Bundle changed; your draft is kept.'},{status:409});}
      if(body.status)detail.lead.status=body.status;else detail={...detail,bundle:{...detail.bundle,title:body.title,prep_note:body.prepNote,sources:body.sources,revision:detail.bundle.revision+1}};
      return Response.json({bundle:detail.bundle});
    }return Response.json(detail);
  }));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><BundleView id="bundle" canManage={canManage}/></QueryClientProvider>);return writes;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('bundle editing and approval',()=>{
  it('saves grouped sources and prep notes before approving only the lead',async()=>{
    const writes=setup();const user=userEvent.setup();await screen.findByLabelText('Story title');await user.click(screen.getByRole('button',{name:'Add supporting source'}));
    await user.type(screen.getByLabelText('Source 1 title'),'Minutes');await user.type(screen.getByLabelText('Source 1 URL'),'https://example.com/minutes');await user.selectOptions(screen.getByLabelText('Source 1 role'),'primary_document');
    expect(screen.getByRole('button',{name:'Approve lead onto deck'})).toBeDisabled();await user.click(screen.getByRole('button',{name:'Save bundle'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Approve lead onto deck'})).toBeEnabled());
    await user.click(screen.getByRole('button',{name:'Approve lead onto deck'}));await waitFor(()=>expect(writes).toContainEqual({id:'lead',status:'approved',expectedStatus:'pending'}));
    expect(writes[0].sources).toEqual([{title:'Minutes',url:'https://example.com/minutes',role:'primary_document'}]);
  });
  it('preserves a conflicting draft until explicitly loading the latest version',async()=>{
    setup(true,true);const user=userEvent.setup();const title=await screen.findByLabelText('Story title');await user.clear(title);await user.type(title,'My unsaved title');await user.click(screen.getByRole('button',{name:'Save bundle'}));
    await screen.findByRole('alert');expect(title).toHaveValue('My unsaved title');await waitFor(()=>expect(screen.getByRole('heading',{level:1})).toHaveTextContent('Newer title'));
    await user.click(screen.getByRole('button',{name:'Load latest bundle'}));await waitFor(()=>expect(title).toHaveValue('Newer title'));
  });
  it('lets read-only moderators see context without editing or approval controls',async()=>{
    setup(false);await screen.findByText('Story bundle: Budget story');expect(screen.queryByLabelText('Story title')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Approve lead onto deck'})).not.toBeInTheDocument();
  });
});
