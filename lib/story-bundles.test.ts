import { describe, expect, it } from 'vitest';
import { bundleMarkdown, relatedBundleSources, validateBundleSettings } from './story-bundles';
const settings={title:' Story ',prepNote:' Prep ',revision:0,sources:[{title:' Minutes ',url:'https://example.com/minutes#page=2',role:'primary_document'}]};
describe('bundle settings',()=>{
  it('normalizes editable fields without accepting ownership changes',()=>{expect(validateBundleSettings({...settings,stream_id:'foreign',lead_submission_id:'foreign'})).toEqual({title:'Story',prep_note:'Prep',revision:0,sources:[{title:'Minutes',url:'https://example.com/minutes',role:'primary_document'}]});});
  it.each([{...settings,title:''},{...settings,revision:-1},{...settings,prepNote:'x'.repeat(10001)},{...settings,sources:Array(13).fill(settings.sources[0])},{...settings,sources:[{...settings.sources[0],url:'javascript:alert(1)'}]},{...settings,sources:[{...settings.sources[0],url:'https://user:password@example.com'}]},{...settings,sources:[{...settings.sources[0],role:'verified'}]}])('rejects malformed bundle %j',body=>expect(()=>validateBundleSettings(body)).toThrow());
  it('rejects duplicate normalized URLs',()=>{expect(()=>validateBundleSettings({...settings,sources:[settings.sources[0],{...settings.sources[0],url:'https://example.com/minutes#other'}]})).toThrow('unique');});
  it('imports only valid unique related-coverage suggestions within the limit',()=>{expect(relatedBundleSources([{title:'Story',url:'https://example.com/source'},{title:'Repeat',url:'https://example.com/source'},{title:'Unsafe',url:'javascript:alert(1)'}],[])).toEqual([{title:'Story',url:'https://example.com/source',role:'coverage'}]);});
  it('exports source roles and shared prep notes from the saved snapshot',()=>{
    expect(bundleMarkdown({id:'bundle',...validateBundleSettings(settings),lead_source:{url:'https://example.com/lead',title:'Lead',kind:'article'}})).toContain('Primary document: [Minutes](https://example.com/minutes)');
  });
});
