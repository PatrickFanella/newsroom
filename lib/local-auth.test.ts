import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { sendLocalMagicLink, verifyLocalMagicLink } from './local-auth';
const mocks=vi.hoisted(()=>({insert:vi.fn(),rpc:vi.fn(),send:vi.fn(),transport:vi.fn(),remove:vi.fn()}));
vi.mock('nodemailer',()=>({default:{createTransport:mocks.transport}}));
vi.mock('./supabase',()=>({supabaseAdmin:()=>({from:()=>({insert:mocks.insert,delete:()=>({eq:mocks.remove})}),rpc:mocks.rpc})}));
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SMTP_HOST','smtp.example.invalid');vi.stubEnv('SMTP_FROM','Broadside <test@example.invalid>');vi.stubEnv('NEXT_PUBLIC_APP_URL','https://newsroom.example.invalid');mocks.transport.mockReturnValue({sendMail:mocks.send});mocks.insert.mockResolvedValue({error:null});mocks.send.mockResolvedValue({});});
afterEach(()=>vi.unstubAllEnvs());
it('stores only a hash and emails a bounded single-use link',async()=>{
 expect(await sendLocalMagicLink('owner@example.invalid')).toEqual({ok:true});
 const message=mocks.send.mock.calls[0][0];const token=new URL(message.text.match(/https:\/\/\S+/)[0]).searchParams.get('token_hash');
 expect(token).toHaveLength(43);expect(mocks.insert.mock.calls[0][0].token_hash).toBe(createHash('sha256').update(token!).digest('hex'));
 expect(mocks.transport.mock.calls[0][0]).toMatchObject({requireTLS:true,connectionTimeout:8000,socketTimeout:10000});
 expect(JSON.stringify(mocks.insert.mock.calls[0][0])).not.toContain(token!);
});
it('removes a token after delivery fails and does not expose SMTP errors',async()=>{
 mocks.send.mockRejectedValue(new Error('private credentials'));expect(await sendLocalMagicLink('owner@example.invalid')).toEqual({ok:false,error:'Sign-in email could not be sent.'});expect(mocks.remove).toHaveBeenCalled();
});
it('never sends if token persistence fails',async()=>{mocks.insert.mockResolvedValue({error:{message:'failed'}});expect((await sendLocalMagicLink('owner@example.invalid')).ok).toBe(false);expect(mocks.send).not.toHaveBeenCalled();});
it('refuses malformed tokens without a database request',async()=>{expect(await verifyLocalMagicLink('bad')).toBeNull();expect(mocks.rpc).not.toHaveBeenCalled();});
it('exchanges the token hash through the atomic consumption RPC',async()=>{mocks.rpc.mockResolvedValue({data:{id:'account',email:'owner@example.invalid'},error:null});const token='a'.repeat(43);expect(await verifyLocalMagicLink(token)).toMatchObject({id:'account'});expect(mocks.rpc).toHaveBeenCalledWith('consume_self_host_login',{p_hash:createHash('sha256').update(token).digest('hex')});});
