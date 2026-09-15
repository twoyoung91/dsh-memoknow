export const MANAGER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MemoKnow</title>
  <script>if(new URLSearchParams(location.search).get('embedded')==='1')document.documentElement.classList.add('embedded')</script>
  <style>
    :root {
      color-scheme: light dark;
      --dsw-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
      --dsw-alias-bg-base: rgb(255, 255, 255);
      --dsw-alias-bg-layer-1: rgb(255, 255, 255);
      --dsw-alias-bg-layer-2: rgb(255, 255, 255);
      --dsw-alias-bg-layer-3: rgb(255, 255, 255);
      --dsw-alias-bg-module-platform: rgb(245, 246, 247);
      --dsw-alias-border-l2: rgba(0, 0, 0, .10);
      --dsw-alias-border-l3: rgba(0, 0, 0, .12);
      --dsw-alias-border-l4: rgba(0, 0, 0, .16);
      --dsw-alias-label-primary: rgb(15, 17, 21);
      --dsw-alias-label-secondary: rgb(97, 102, 107);
      --dsw-alias-label-tertiary: rgb(129, 133, 140);
      --dsw-alias-label-dimmed: rgb(225, 229, 238);
      --dsw-alias-label-primary-foreground: rgb(255, 255, 255);
      --dsw-alias-button-primary-fill: rgb(15, 17, 21);
      --dsw-alias-button-primary-hover: rgb(67, 69, 74);
      --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, .06);
      --dsw-alias-interactive-bg-hover-danger: rgba(236, 19, 19, .05);
      --dsw-alias-state-business-primary: rgb(65, 118, 230);
      --dsw-alias-state-error-primary: rgb(236, 19, 19);
      --dsw-alias-state-success-primary: rgb(34, 197, 94);
      --dsw-alias-markdown-inline-code: rgb(250, 250, 250);
    }
    * { box-sizing: border-box; }
    html { background: var(--dsw-alias-bg-base); }
    body {
      min-height: 100vh;
      margin: 0;
      background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary);
      font: 14px/1.5 var(--dsw-font-family);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    button, input, select, textarea { font-family: inherit; }
    .shell { width: min(100%, 1100px); margin: 0 auto; padding: 40px 32px 64px; }
    .embedded body { min-height: 0; }
    .embedded .shell { width: 100%; max-width: none; padding: 2px 2px 32px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; margin-bottom: 28px; }
    h1 { margin: 0; font-size: 28px; font-weight: 600; line-height: 36px; letter-spacing: -.02em; }
    .subtitle { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
    .stats { display: flex; gap: 8px; }
    .stat { min-width: 104px; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-3); }
    .stat strong { display: block; font-size: 20px; font-weight: 600; line-height: 24px; }
    .stat span { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
    nav { display: flex; align-items: flex-end; gap: 22px; margin-bottom: 20px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
    nav button { position: relative; appearance: none; border: 0; padding: 7px 1px 9px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
    nav button:hover, nav button.active { color: var(--dsw-alias-label-primary); }
    nav button.active::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 2px 2px 0 0; background: var(--dsw-alias-label-primary); content: ""; }
    nav button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: 2px; }
    .panel { display: none; }
    .panel.active { display: block; }
    .grid { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .card { min-width: 0; padding: 16px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); }
    h2 { margin: 0 0 14px; font-size: 15px; font-weight: 600; line-height: 1.4; }
    label { display: grid; gap: 6px; margin-bottom: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
    label span { color: var(--dsw-alias-label-tertiary); }
    input, textarea, select { width: 100%; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 7px 10px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
    input, select { min-height: 36px; }
    input::placeholder, textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
    input:focus, textarea:focus, select:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary); }
    textarea { min-height: 120px; resize: vertical; }
    button.primary, button.quiet, button.danger { min-height: 32px; border-radius: 16px; padding: 5px 14px; font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
    button.primary { border: .5px solid transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
    button.primary:hover { background: var(--dsw-alias-button-primary-hover); }
    button.quiet { border: .5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }
    button.quiet:hover { background: var(--dsw-alias-interactive-bg-hover); }
    button.danger { border: .5px solid transparent; background: transparent; color: var(--dsw-alias-state-error-primary); }
    button.danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); }
    button.primary:focus-visible, button.quiet:focus-visible, button.danger:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
    .toolbar input { flex: 1; min-width: 0; }
    .list { display: grid; gap: 8px; }
    .item { padding: 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
    .item-head { display: flex; justify-content: space-between; gap: 12px; }
    .item p { margin: 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .meta { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
    .actions { display: flex; gap: 4px; margin-top: 8px; }
    .empty { padding: 36px 16px; color: var(--dsw-alias-label-tertiary); text-align: center; }
    .message { min-height: 20px; margin-top: 10px; color: var(--dsw-alias-state-success-primary); font-size: 12px; }
    .message.error { color: var(--dsw-alias-state-error-primary); }
    [hidden] { display: none !important; }
    code { padding: 2px 5px; border-radius: 5px; background: var(--dsw-alias-markdown-inline-code); color: var(--dsw-alias-label-primary); }
    @media (max-width: 760px) {
      .shell { padding: 24px 16px 48px; }
      header { flex-direction: column; gap: 16px; }
      .stats { width: 100%; overflow-x: auto; }
      .stat { flex: 1 0 96px; }
      nav { gap: 18px; overflow-x: auto; }
      nav button { white-space: nowrap; }
      .grid { grid-template-columns: 1fr; }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --dsw-alias-bg-base: rgb(21, 21, 23);
        --dsw-alias-bg-layer-1: rgb(35, 35, 36);
        --dsw-alias-bg-layer-2: rgb(44, 44, 46);
        --dsw-alias-bg-layer-3: rgb(53, 54, 56);
        --dsw-alias-bg-module-platform: rgb(53, 54, 56);
        --dsw-alias-border-l2: rgba(255, 255, 255, .12);
        --dsw-alias-border-l3: rgba(255, 255, 255, .16);
        --dsw-alias-border-l4: rgba(255, 255, 255, .20);
        --dsw-alias-label-primary: rgb(249, 250, 251);
        --dsw-alias-label-secondary: rgb(207, 211, 214);
        --dsw-alias-label-tertiary: rgb(173, 178, 184);
        --dsw-alias-label-dimmed: rgb(67, 69, 74);
        --dsw-alias-label-primary-foreground: rgb(15, 17, 21);
        --dsw-alias-button-primary-fill: rgb(249, 250, 251);
        --dsw-alias-button-primary-hover: rgb(235, 238, 242);
        --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, .08);
        --dsw-alias-interactive-bg-hover-danger: rgba(242, 90, 90, .15);
        --dsw-alias-state-business-primary: rgb(103, 158, 254);
        --dsw-alias-state-error-primary: rgb(242, 90, 90);
        --dsw-alias-markdown-inline-code: rgb(41, 41, 41);
      }
    }
  </style>
</head>
<body><div class="shell">
  <header><div><h1>MemoKnow</h1><p class="subtitle">Private memory and knowledge, stored on this machine.</p></div><div class="stats"><div class="stat"><strong id="sm">–</strong><span>memories</span></div><div class="stat"><strong id="sd">–</strong><span>documents</span></div><div class="stat"><strong id="sc">–</strong><span>chunks</span></div></div></header>
  <nav role="tablist" aria-label="MemoKnow sections"><button role="tab" aria-selected="true" data-tab="memory" class="active">Memory</button><button role="tab" aria-selected="false" data-tab="knowledge">Knowledge</button><button role="tab" aria-selected="false" data-tab="settings">Setup & settings</button></nav>
  <section id="memory" role="tabpanel" class="panel active"><div class="grid"><form id="memory-form" class="card"><h2>Write a memory</h2><label>Kind<select name="kind"><option>fact</option><option>preference</option><option>decision</option><option>relationship</option><option>procedure</option><option>goal</option><option>note</option></select></label><label>Content<textarea name="content" maxlength="32000" required placeholder="A durable fact, preference, or decision…"></textarea></label><label>Importance<input name="importance" type="number" min="0" max="1" step="0.1" value="0.5"></label><button class="primary">Remember</button><div class="message" role="status" aria-live="polite"></div></form><div class="card"><div class="toolbar"><input id="memory-query" type="search" aria-label="Search memories" placeholder="Search memories"><button id="memory-search" class="quiet">Search</button></div><div id="memory-list" class="list"></div></div></div></section>
  <section id="knowledge" role="tabpanel" class="panel"><div class="grid"><form id="knowledge-form" class="card"><h2>Import knowledge</h2><label>Title <span>Optional for files</span><input name="title" maxlength="500"></label><label>Document file<input name="file" type="file" accept=".doc,.docx,.pdf,.csv,.xlsx"><span>DOC, DOCX, PDF, CSV, or XLSX · maximum 25 MiB · embedded images are ignored</span></label><label>Or paste text<textarea name="content" placeholder="Paste text or Markdown…"></textarea></label><label>Pasted text format<select name="mediaType"><option value="text/markdown">Markdown</option><option value="text/plain">Plain text</option></select></label><button class="primary">Import snapshot</button><div class="message" role="status" aria-live="polite"></div></form><div class="card"><div id="knowledge-list" class="list"></div></div></div></section>
  <section id="settings" role="tabpanel" class="panel"><form id="settings-form" class="card setup"><h2>Retrieval setup</h2><p class="meta">Local FTS works without a model. Embedding modes add semantic retrieval through sqlite-vec while retaining FTS fallback.</p><p class="meta" data-managed-embedding hidden>Embedding settings are managed by your organization.</p><label>Retrieval mode<select name="embeddingMode"><option value="fts">Local FTS</option><option value="local-cpu">Local CPU embedding</option><option value="api">OpenAI-compatible embedding model</option></select></label><label data-api-setting hidden>Embedding API base URL<input name="embeddingBaseUrl" placeholder="https://provider.example/v1"></label><label data-api-setting hidden>Embedding model<input name="embeddingModel" placeholder="embedding-model-id"></label><label data-api-setting hidden>API-key environment variable<input name="embeddingApiKeyEnv" value="MEMOKNOW_EMBEDDING_API_KEY"><span>The secret itself is never stored in MemoKnow.</span></label><label data-local-cpu-setting hidden>Local CPU model<input name="localEmbeddingModel" value="Xenova/multilingual-e5-small" readonly><span>The INT8 model (about 140 MiB including tokenizer files) is downloaded only when you enable this mode, then cached in MemoKnow's local data folder.</span></label><label>Memory half-life (days)<input name="memoryHalfLifeDays" type="number" min="1" max="3650"><span>Defaults to 180 days. Older memories fade in rank but are not deleted.</span></label><label>Maximum memory results<input name="maxMemoryResults" type="number" min="1" max="100"><span>Defaults to 12. Knowledge has no user-configured result limit.</span></label><button class="primary" data-save disabled>Save setup</button><div class="message" role="status" aria-live="polite"></div></form></section>
</div><script>
const A='/_dsh/memoknow/api';let settingsSnapshot=null;const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options){const o=Object.assign({credentials:'same-origin'},options||{});if(!(o.body instanceof FormData))o.headers=Object.assign({'content-type':'application/json'},o.headers||{});const r=await fetch(A+path,o);const p=await r.json().catch(()=>null);if(!r.ok||!p||p.ok!==true)throw new Error(p&&p.error?p.error.message:'HTTP '+r.status);return p.value}
function msg(form,text,error){const e=form.querySelector('.message');e.textContent=text||'';e.className='message'+(error?' error':'')}
async function dashboard(){const d=await api('/dashboard');document.querySelector('#sm').textContent=d.stats.memories;document.querySelector('#sd').textContent=d.stats.knowledgeDocuments;document.querySelector('#sc').textContent=d.stats.knowledgeChunks;settingsSnapshot=d.settings;fillSettings(d.settings);document.querySelector('[data-save]').disabled=false}
function fillSettings(snapshot){const v=snapshot.value,management=snapshot.management,f=document.querySelector('#settings-form'),managedEmbedding=management?.embedding==='managed-api';for(const k of ['embeddingMode','embeddingBaseUrl','embeddingModel','embeddingApiKeyEnv','localEmbeddingModel','memoryHalfLifeDays','maxMemoryResults'])if(f.elements[k])f.elements[k].value=v[k];for(const key of ['embeddingMode','embeddingBaseUrl','embeddingModel','embeddingApiKeyEnv']){const control=f.elements[key];if(control)control.disabled=managedEmbedding}document.querySelector('[data-managed-embedding]').hidden=!managedEmbedding;toggleProviderSettings(v)}
function toggleProviderSettings(v){const apiMode=v.embeddingMode==='api',localMode=v.embeddingMode==='local-cpu';document.querySelectorAll('[data-api-setting]').forEach(e=>e.hidden=!apiMode);document.querySelectorAll('[data-local-cpu-setting]').forEach(e=>e.hidden=!localMode);document.querySelector('[data-save]').textContent=localMode?'Download and enable':apiMode?'Validate and enable':'Save setup'}
async function loadMemories(){const q=document.querySelector('#memory-query').value.trim();let rows;if(q){rows=(await api('/search?q='+encodeURIComponent(q)+'&includeArchived=true')).filter(x=>x.domain==='memory')}else rows=await api('/memories');const box=document.querySelector('#memory-list');box.innerHTML=rows.length?rows.map(m=>'<article class="item"><div class="item-head"><strong>'+esc(m.kind)+'</strong><span class="meta">'+esc(m.status)+' · r'+esc(m.revision)+'</span></div><p>'+esc(m.content)+'</p><div class="actions"><button class="quiet" data-edit="'+esc(m.id)+'">Edit</button><button class="danger" data-forget="'+esc(m.id)+'">Forget</button></div></article>').join(''):'<div class="empty">No memories found.</div>';box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editMemory(b.dataset.edit,rows));box.querySelectorAll('[data-forget]').forEach(b=>b.onclick=()=>forgetMemory(b.dataset.forget,rows))}
async function editMemory(id,rows){const m=rows.find(x=>x.id===id);const content=prompt('Edit memory',m.content);if(content===null||!content.trim())return;await api('/memories/'+id,{method:'PATCH',body:JSON.stringify({expectedRevision:m.revision,content})});await Promise.all([loadMemories(),dashboard()])}
async function forgetMemory(id,rows){const m=rows.find(x=>x.id===id);if(!confirm('Permanently forget this memory? This cannot be undone.'))return;await api('/memories/'+id,{method:'DELETE',body:JSON.stringify({expectedRevision:m.revision})});await Promise.all([loadMemories(),dashboard()])}
async function loadKnowledge(){const rows=await api('/knowledge');const box=document.querySelector('#knowledge-list');box.innerHTML=rows.length?rows.map(d=>'<article class="item"><div class="item-head"><strong>'+esc(d.title)+'</strong><span class="meta">'+d.chunkCount+' chunks</span></div><p class="meta">'+esc(d.mediaType)+' · vectors '+esc(d.embeddingStatus)+' · sha256 '+esc(d.sha256.slice(0,12))+'…</p><button class="danger" data-remove="'+esc(d.id)+'">Remove</button></article>').join(''):'<div class="empty">No knowledge imported.</div>';box.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const d=rows.find(x=>x.id===b.dataset.remove);if(confirm('Remove this document and its index?')){await api('/knowledge/'+d.id,{method:'DELETE',body:JSON.stringify({expectedRevision:d.revision})});await Promise.all([loadKnowledge(),dashboard()])}})}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-selected','false')});document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');b.setAttribute('aria-selected','true');document.querySelector('#'+b.dataset.tab).classList.add('active')});
document.querySelector('#memory-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{const d=Object.fromEntries(new FormData(f));d.importance=Number(d.importance);await api('/memories',{method:'POST',body:JSON.stringify(d)});f.elements.content.value='';msg(f,'Memory saved.');await Promise.all([loadMemories(),dashboard()])}catch(x){msg(f,x.message,true)}};
document.querySelector('#knowledge-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{const data=new FormData(f),file=f.elements.file.files[0],content=String(data.get('content')||'').trim();if(file){await api('/knowledge/file',{method:'POST',body:data});f.elements.file.value=''}else{if(!content)throw new Error('Choose a file or paste some text.');if(!String(data.get('title')||'').trim())throw new Error('A title is required for pasted text.');await api('/knowledge',{method:'POST',body:JSON.stringify(Object.fromEntries(data))})}f.elements.content.value='';msg(f,'Document imported and indexed.');await Promise.all([loadKnowledge(),dashboard()])}catch(x){msg(f,x.message,true)}};
document.querySelector('#settings-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,button=f.querySelector('[data-save]'),mode=f.elements.embeddingMode.value;button.disabled=true;msg(f,mode==='local-cpu'?'Downloading and checking the local model…':mode==='api'?'Checking the embedding API and indexing knowledge…':'Saving settings…');try{const current=settingsSnapshot??await api('/settings');const v={...current.value,...Object.fromEntries(new FormData(f))};v.setupComplete=true;v.memoryHalfLifeDays=Number(v.memoryHalfLifeDays);v.maxMemoryResults=Number(v.maxMemoryResults);settingsSnapshot=await api('/settings',{method:'PATCH',body:JSON.stringify({expectedRevision:current.revision,value:v})});fillSettings(settingsSnapshot);msg(f,'Settings saved and retrieval is ready.')}catch(x){msg(f,x.message,true)}finally{button.disabled=settingsSnapshot===null;toggleProviderSettings({embeddingMode:f.elements.embeddingMode.value})}};
document.querySelector('#settings-form').elements.embeddingMode.onchange=e=>toggleProviderSettings({embeddingMode:e.currentTarget.value});
document.querySelector('#memory-search').onclick=loadMemories;document.querySelector('#memory-query').onkeydown=e=>{if(e.key==='Enter')loadMemories()};Promise.all([dashboard(),loadMemories(),loadKnowledge()]).catch(e=>alert('MemoKnow: '+e.message));
</script></body></html>`
