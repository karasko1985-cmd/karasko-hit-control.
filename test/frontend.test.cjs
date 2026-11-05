const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
class Element {
  constructor(id = '') { this.id = id; this.textContent = ''; this.disabled = false; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.checked = false; this.style = {}; this.classes = new Set(); this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value), toggle: (value, force) => { const use = force === undefined ? !this.classes.has(value) : force; use ? this.classes.add(value) : this.classes.delete(value); return use; }, contains: value => this.classes.has(value) }; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  remove() {}
  click() { return this.listeners.click?.({currentTarget:this}); }
  querySelectorAll() { return []; }
}
const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1],new Element(match[1])]));
const tabs = ['combined','lyrics','style','review'].map(value => { const el = elements[`button-${value}`]; el.dataset.tab = value; return el; });
const panels = tabs.map(el => elements[`tab-${el.dataset.tab}`]);
const copies = ['combined','lyrics','style','exclude','pack'].map(value => { const el = new Element(); el.dataset.copy = value; return el; });
const manualInputs = [new Element(), new Element(), new Element()];
elements.manualOptions.querySelectorAll = () => manualInputs;
elements.autoMatch.checked = true;
const document = { getElementById: id => { assert.ok(elements[id], `unknown id ${id}`); return elements[id]; }, createElement: () => new Element(), querySelectorAll: selector => selector === '.tab' ? tabs : selector === '.tab-content' ? panels : selector === '[data-copy]' ? copies : [], body: new Element() };
const result = { song:{ title:'Test',concept:'Historia',lyrics:'[Chorus]\nRymy',style:'Polish rap',exclude:'shouts' }, brief:{ title:'Test' }, pack:{ title:'Test', titleLocked:true, lyrics:'[Chorus]\nRymy', style:'Polish rap', tags:['cinematic rap','hard drums','catchy hook'], bpm:96, key:'F# minor', beatNotes:'Twarda stopa i stop przed hookiem.', vocalNotes:'Niski rap, szerszy refren.', arrangement:'Drop w refrenie po krótkim stopie.', checklist:['Rymy płyną','Hook jest zdaniem'] }, review:{scores:{rhymes:8,flow:7,naturalness:8,hook:8,story:7,originality:8,style_fit:9},passed:false,issues:['test'],fixes:['popraw'],evidence:[{category:'rhymes',quote:'Rymy',reason:'test'}]}, selectedIteration:1,revisions:[{iteration:1,selected:true,scores:{rhymes:8}},{iteration:2,selected:false,scores:{rhymes:7}}],usage:{calls:4,input:10,output:20},model:'test-model',estimatedUsd:null,direction:{genre:'Rap',bpm:96,mood:'dark',vocal:'low',production:'drums',why:'fit'} };
let queue = [{configured:true,model:'test-model',maxCalls:8}];
const sent = []; let copied;
const sandbox = { document, navigator:{clipboard:{writeText: async text => {copied = text;}}}, console, AbortSignal, FormData:class { constructor() {} entries() {return Object.entries({title:'Z blizn robię pancerz',topic:'Historia',preferences:'Mocne rymy',mode:'quality'});}}, fetch:async (url,options) => { sent.push([url,options]); assert.ok(queue.length,`unexpected fetch ${url}`); const response = queue.shift(); return {ok:response.ok !== false,status:response.statusCode || 200,json:async()=>response}; }, setTimeout:callback => {callback();return 0;}, sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}}, URL, Blob };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'),sandbox);
test('frontend handles queued jobs, combined copy, selected revision and preserves output on failure', async () => {
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(manualInputs.every(el=>el.disabled));
  elements.autoMatch.checked = false; elements.autoMatch.listeners.change();
  assert.ok(manualInputs.every(el=>!el.disabled));
  queue.push({id:'job-1',status:'queued'},{status:'running',progress:{message:'Redakcja…'}},{status:'completed',result});
  await elements.form.listeners.submit({preventDefault(){},currentTarget:elements.form});
  assert.match(elements.combined.textContent,/=== LYRICS ===/);
  assert.match(elements.combined.textContent,/=== STYLE ===/);
  assert.match(elements.combined.textContent,/=== TAGS ===/);
  assert.match(elements.combined.textContent,/=== BPM \/ KEY ===/);
  assert.match(elements.combined.textContent,/96 BPM · F# minor/);
  assert.match(elements.combined.textContent,/=== BEAT ===/);
  assert.match(elements.combined.textContent,/=== VOCAL ===/);
  assert.match(elements.combined.textContent,/=== ARRANGEMENT ===/);
  assert.match(elements.combined.textContent,/=== CHECKLIST ===/);
  assert.match(elements.combined.textContent,/=== EXCLUDE ===/);
  assert.equal(elements.titleLock.classList.contains('hidden'), false);
  assert.match(elements.titleLock.textContent, /Test/);
  assert.match(elements.packBeat.textContent, /Twarda stopa/);
  assert.match(elements.packVocal.textContent, /Niski rap/);
  assert.match(elements.packArrangement.textContent, /Drop w refrenie/);
  assert.match(elements.packChecklist.children[0].textContent, /Rymy płyną/);
  assert.equal(elements['button-combined'].attributes['aria-selected'],'true');
  assert.ok(elements.iterations.children[0].textContent.includes('wersja końcowa'));
  assert.ok(!elements.iterations.children[1].textContent.includes('wersja końcowa'));
  assert.equal(elements.go.disabled,false);
  assert.ok(elements.output.classList.contains('hidden') === false);
  await copies[0].click();
  assert.equal(copied,elements.combined.textContent);
  await copies[4].click();
  assert.equal(copied,elements.combined.textContent);
  assert.match(copied,/Tytuł zablokowany/);
  queue.push({ok:false,statusCode:429,error:'Zaczekaj'});
  await elements.form.listeners.submit({preventDefault(){},currentTarget:elements.form});
  assert.equal(elements.error.textContent,'Zaczekaj');
  assert.equal(elements.output.classList.contains('hidden'),false);
  assert.equal(elements.combined.textContent,copied);
  assert.equal(queue.length, 0);
  assert.equal(sent[1][0], '/api/jobs');
  const submitted = JSON.parse(sent[1][1].body);
  assert.equal(submitted.mode, 'quality');
  assert.equal(submitted.preferences, 'Mocne rymy');
  assert.equal(submitted.title, 'Z blizn robię pancerz');
});
