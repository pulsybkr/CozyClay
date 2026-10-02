// UI flow QA without a connected browser: run the shipped controller against a
// minimal DOM and a mocked HTTP boundary. No analysis or publication reaches a server.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const fixture=JSON.parse(readFileSync(new URL('../../test/fixtures/production/narrative-v2.json',import.meta.url),'utf8'));
class Element {
 constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.style={};this.dataset={};this.listeners={};}
 addEventListener(type,fn){this.listeners[type]=fn;}
 async click(){assert.equal(this.disabled,false,this.id+' must be enabled');await this.listeners.click?.({target:this});}
}
const names=['title','tts','model','instructions','apply','publish','start','cancel','message','meta','history','resume','status','scenes','content','log'];
const elements=Object.fromEntries(names.map(name=>['n-'+name,new Element('n-'+name)]));
elements['n-content'].innerHTML='Empty state';
const root=new Element('narrative-app');root.dataset.projectId='narrative';elements['narrative-app']=root;
const requests=[], jobs=[], tasks=[];
let failFirstLaunch = true;
const source={canAnalyse:true,title:'Test',selectedTtsId:1,defaultModel:'test',draftVersion:null,ttsOptions:[{id:1,voice:'test',durationSeconds:4,transcribed:true}],durationSeconds:4,frameCount:96,segments:[{},{}],sourceFingerprint:'sha256:source'};
const candidate={candidateVersion:1,draft:fixture,readiness:{directivesReady:true},sourceFingerprint:source.sourceFingerprint};
const fetch=async(url,options)=>{
 requests.push({url,...options});
 let data;
 if(url.includes('/sources'))data={...source};
 else if(url.endsWith('/analyses') && options.method==='GET')data={analyses:jobs};
 else if(url.endsWith('/analyses')){if(!jobs.length)jobs.push({id:'story_1',status:'succeeded',model:'test',createdAt:'2026-10-01T12:00:00',selectedTtsId:1,instructions:''});data={preparationId:'story_1'};if(failFirstLaunch){failFirstLaunch=false;throw new Error('Network response lost after launch');}}
 else if(url.includes('/result'))data=candidate;
 else if(url.includes('/apply')){source.draftVersion='v_saved';data={draftVersion:'v_saved'};}
 else if(url.includes('/revisions'))data={revision:'r_saved'};
 else data={preparationId:'story_1',status:'succeeded',stage:'complete',events:[]};
 return {ok:true,json:async()=>data};
};
const context=vm.createContext({document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},window:{addEventListener(){}},fetch,crypto:webcrypto,setTimeout:fn=>{tasks.push(fn);return tasks.length;},clearTimeout(){},console});
vm.runInContext(readFileSync(new URL('./backend/app/static/js/studio-narrative.js',import.meta.url),'utf8'),context);
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
await settle();
assert.equal(elements['n-start'].disabled,false);
assert.equal(elements['n-publish'].disabled,true);
await elements['n-start'].click();await settle();
assert.equal(elements['n-start'].disabled,false);
await elements['n-start'].click();await settle();
const launches=requests.filter(r=>r.url.endsWith('/analyses')&&r.method==='POST');
assert.equal(launches.length,2);
assert.equal(launches[0].headers['Idempotency-Key'],launches[1].headers['Idempotency-Key'],'retry after uncertain network failure reuses the same launch key');
assert.ok(elements['n-content'].innerHTML.includes('Caméras & cuts'));
assert.ok(elements['n-content'].innerHTML.includes('Travelling'));
assert.ok(elements['n-content'].innerHTML.includes('Raise the right arm'));
assert.ok(elements['n-content'].innerHTML.includes('Continuité de la scène'));
assert.equal(elements['n-apply'].disabled,false);
assert.equal(elements['n-publish'].disabled,true);
await elements['n-apply'].click();await settle();
assert.equal(elements['n-publish'].disabled,false);
const apply=JSON.parse(requests.find(r=>r.url.endsWith('/apply')).body);
assert.equal(apply.expectedSourceFingerprint,source.sourceFingerprint);
await elements['n-publish'].click();await settle();
assert.equal(JSON.parse(requests.find(r=>r.url.endsWith('/revisions')).body).draftVersion,'v_saved');
assert.ok(elements['n-message'].textContent.includes('r_saved'));
assert.equal(requests.filter(r=>r.url.endsWith('/revisions')).length,1);
assert.ok(requests.every(r=>r.headers['X-UI-Client']==='reproduction'));
console.log('PASS page flow: sources → analyse → scenes/actions/cameras/continuity → apply → publish, with explicit buttons and draft/source version checks.');
