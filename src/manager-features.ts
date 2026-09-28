export const FEATURE_STYLES = `
  .actions, .toolbar { flex-wrap: wrap; }
  .toolbar select { width: auto; max-width: 100%; }
  .item-head, .meta { overflow-wrap: anywhere; }
  button:disabled { opacity: .55; cursor: wait; }
  .check { display: flex; align-items: center; gap: 8px; }
  .check input { width: 18px; min-height: 18px; }
  dialog { width: min(720px, calc(100% - 32px)); max-height: 85vh; padding: 24px;
    border: 1px solid var(--dsw-alias-border-l4); border-radius: 16px;
    background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
  dialog::backdrop { background: rgba(0,0,0,.45); }
  .preview-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .preview-chunk { border-top: 1px solid var(--dsw-alias-border-l2); padding: 12px 0; }
  .preview-chunk:target, .preview-chunk.match { border-left: 3px solid var(--dsw-alias-state-business-primary); padding-left: 12px; }
  .stack { display: grid; gap: 16px; }
  .message { color: var(--dsw-alias-label-secondary); }
`

export const MEMORY_LIBRARY = `
  <div class="card" id="memory-library"><h2>Memory library</h2>
    <form id="memory-search-form" class="toolbar">
      <input id="memory-query" type="search" aria-label="Search memories" placeholder="Search memories">
      <button id="memory-search" class="quiet">Search</button>
    </form>
    <label>Show memories<select id="memory-status">
      <option value="">All memories</option><option value="candidate">Review inbox</option>
      <option value="active">Active</option><option value="disputed">Disputed</option>
      <option value="stale">Stale</option><option value="archived">Archived / dismissed</option>
      <option value="superseded">Superseded</option>
    </select></label>
    <p class="meta">Only active, non-expired memories are used in normal recall. Dismiss archives a suggestion; Forget deletes it.</p>
    <div class="message" role="status" aria-live="polite"></div>
    <div id="memory-list" class="list"></div>
    <div class="actions"><button id="memory-prev" class="quiet">Previous</button><button id="memory-next" class="quiet">Next</button></div>
  </div>`

export const KNOWLEDGE_LIBRARY = `
  <div class="card" id="knowledge-library"><h2>Knowledge library</h2>
    <form id="knowledge-search-form" class="toolbar">
      <input id="knowledge-query" type="search" aria-label="Search knowledge" placeholder="Search document contents">
      <button class="quiet">Search</button><button id="knowledge-clear" type="button" class="quiet">Clear</button>
    </form>
    <div class="message" role="status" aria-live="polite"></div><div id="knowledge-list" class="list"></div>
    <div class="actions"><button id="knowledge-prev" class="quiet">Previous</button><button id="knowledge-next" class="quiet">Next</button></div>
  </div>`

export const LEARNING_PANEL = `
  <section id="learning" role="tabpanel" class="panel"><div class="grid">
    <form id="learning-form" class="card"><h2>Automatic memory</h2>
      <label class="check"><input type="checkbox" name="paused">Pause learning</label>
      <p class="meta">Pausing stops new capture and processing. Skipped turns are not learned after resuming. Earlier pending turns remain queued. Explicit Remember tools still work.</p>
      <label>Token budget per session<input name="maxSessionTokens" type="number" min="0" max="10000000" step="1" required></label>
      <label>Token budget per UTC day<input name="maxDailyTokens" type="number" min="0" max="100000000" step="1" required></label>
      <p class="meta">Zero stops processing but still queues eligible turns. Pause learning to stop capture too.</p>
      <button class="primary" disabled>Save learning controls</button><div class="message" role="status" aria-live="polite"></div>
    </form>
    <div class="stack"><div class="card" id="learning-activity"><div class="toolbar"><h2>Learning activity</h2><button id="learning-refresh" class="quiet">Refresh</button></div>
      <p id="learning-summary" class="meta">Loading activity…</p>
      <div class="message" role="status" aria-live="polite"></div><div id="learning-sessions" class="list"></div>
      <div class="actions"><button id="learning-prev" class="quiet">Previous</button><button id="learning-next" class="quiet">Next</button></div>
    </div><div class="card"><h2>Excluded sessions</h2><p class="meta">Exclude a session before chatting there, or use Exclude beside a recent session. Removing an exclusion resumes future learning.</p>
      <form id="exclude-form"><label>Session ID<input name="sessionId" maxlength="500" required></label><button class="quiet">Exclude session</button><div class="message" role="status" aria-live="polite"></div></form>
      <div id="excluded-sessions" class="list"></div>
    </div></div>
  </div></section>
  <dialog id="memory-editor" aria-labelledby="memory-editor-title"><form id="memory-edit-form">
    <h2 id="memory-editor-title">Edit memory</h2><p id="memory-origin" class="meta"></p>
    <label>Content<textarea name="content" maxlength="32000" required></textarea></label>
    <label>State<select name="status"><option value="candidate">Needs review</option><option value="active">Approved / active</option><option value="disputed">Disputed</option><option value="stale">Stale</option><option value="archived">Archived</option><option value="superseded">Superseded</option></select></label>
    <label>Expires at (optional, ISO date-time)<input name="expiresAt" placeholder="2027-01-01T00:00:00Z"></label>
    <div class="message" role="status" aria-live="polite"></div>
    <div class="actions"><button class="primary">Save memory</button><button type="button" class="quiet" data-close="memory-editor">Cancel</button></div>
  </form></dialog>
  <dialog id="knowledge-preview" aria-labelledby="preview-title"><div class="toolbar"><h2 id="preview-title">Document preview</h2><button class="quiet" data-close="knowledge-preview">Close</button></div>
    <p id="preview-meta" class="meta"></p><p class="meta">Extracted text; images and original layout are not shown. Adjacent passages may overlap.</p>
    <div class="message" role="status" aria-live="polite"></div><div id="preview-chunks"></div>
    <div class="actions"><button id="preview-prev" class="quiet">Previous passages</button><button id="preview-next" class="quiet">Next passages</button></div>
  </dialog>`

export const FEATURE_SCRIPT = String.raw`
let memoryOffset=0,knowledgeOffset=0,learningOffset=0,learningSnapshot=null,editingMemory=null,previewDocument=null,previewOffset=0,previewMatch=-1;
let memoryRequest=0,knowledgeRequest=0,previewRequest=0,learningRequest=0;
const pageSize=20;
async function action(button,container,work){button.disabled=true;msg(container,'');try{await work()}catch(error){msg(container,error.message,true)}finally{button.disabled=false}}
function originLabel(source){return source.kind+(source.sessionId?' · session '+source.sessionId:'')+(source.evidenceTurns?.length?' · turns '+source.evidenceTurns.join(', '):'')+(source.replaces?' · proposed replacement for '+source.replaces.id:'')}
async function loadMemories(){
  const request=++memoryRequest,box=document.querySelector('#memory-list'),container=document.querySelector('#memory-library');
  box.setAttribute('aria-busy','true');
  try{
    const params=new URLSearchParams({q:document.querySelector('#memory-query').value.trim(),limit:String(pageSize),offset:String(memoryOffset)});
    const status=document.querySelector('#memory-status').value;if(status)params.set('status',status);
    const rows=await api('/memories?'+params);if(request!==memoryRequest)return;
    box.innerHTML=rows.length?rows.map(m=>'<article class="item"><div class="item-head"><strong>'+esc(m.kind)+'</strong><span class="meta">'+esc(m.status)+(m.expiresAt&&Date.parse(m.expiresAt)<=Date.now()?' · expired':'')+'</span></div><p>'+esc(m.content)+'</p><p class="meta">'+esc(originLabel(m.source))+'</p><div class="actions">'+(m.status==='candidate'?'<button class="primary" data-approve="'+esc(m.id)+'">Approve</button><button class="quiet" data-dismiss="'+esc(m.id)+'">Dismiss</button>':'')+'<button class="quiet" data-edit="'+esc(m.id)+'">Edit</button><button class="danger" data-forget="'+esc(m.id)+'">Forget</button></div></article>').join(''):'<div class="empty">'+(status==='candidate'?'Your review inbox is empty.':'No memories match this view.')+'</div>';
    for(const button of box.querySelectorAll('button'))button.onclick=()=>action(button,container,async()=>{
      const id=button.dataset.approve||button.dataset.dismiss||button.dataset.edit||button.dataset.forget,m=rows.find(row=>row.id===id);
      if(button.dataset.edit){editingMemory=m;const form=document.querySelector('#memory-edit-form');form.elements.content.value=m.content;form.elements.status.value=m.status;form.elements.expiresAt.value=m.expiresAt||'';document.querySelector('#memory-origin').textContent=originLabel(m.source);msg(form,'');document.querySelector('#memory-editor').showModal();return}
      if(button.dataset.forget){if(!confirm('Permanently forget this memory? This cannot be undone.'))return;await api('/memories/'+id,{method:'DELETE',body:JSON.stringify({expectedRevision:m.revision})})}
      else await api('/memories/'+id,{method:'PATCH',body:JSON.stringify({expectedRevision:m.revision,status:button.dataset.approve?'active':'archived'})});
      await Promise.all([loadMemories(),dashboard()]);
    });
    document.querySelector('#memory-prev').disabled=memoryOffset===0;document.querySelector('#memory-next').disabled=rows.length<pageSize;
  }catch(error){if(request===memoryRequest)msg(container,error.message,true)}finally{if(request===memoryRequest)box.removeAttribute('aria-busy')}
}
document.querySelector('#memory-edit-form').onsubmit=event=>{
  event.preventDefault();const form=event.currentTarget,m=editingMemory;
  void action(form.querySelector('button'),form,async()=>{
    await api('/memories/'+m.id,{method:'PATCH',body:JSON.stringify({expectedRevision:m.revision,content:form.elements.content.value,status:form.elements.status.value,expiresAt:form.elements.expiresAt.value.trim()||null})});
    document.querySelector('#memory-editor').close();await Promise.all([loadMemories(),dashboard()]);
  });
};
document.querySelector('#memory-search-form').onsubmit=event=>{event.preventDefault();memoryOffset=0;void loadMemories()};
document.querySelector('#memory-status').onchange=()=>{memoryOffset=0;void loadMemories()};
document.querySelector('#memory-prev').onclick=()=>{memoryOffset=Math.max(0,memoryOffset-pageSize);void loadMemories()};
document.querySelector('#memory-next').onclick=()=>{memoryOffset+=pageSize;void loadMemories()};

async function loadKnowledge(){
  const request=++knowledgeRequest,container=document.querySelector('#knowledge-library'),box=document.querySelector('#knowledge-list'),q=document.querySelector('#knowledge-query').value.trim();
  box.setAttribute('aria-busy','true');
  try{
    const rows=await api(q?'/search?domain=knowledge&limit=100&q='+encodeURIComponent(q):'/knowledge?limit='+pageSize+'&offset='+knowledgeOffset);
    if(request!==knowledgeRequest)return;
    box.innerHTML=rows.length?rows.map(d=>q?'<article class="item"><strong>'+esc(d.title)+'</strong><p>'+esc(d.content)+'</p><button class="quiet" data-preview="'+esc(d.documentId)+'" data-ordinal="'+d.ordinal+'">View passage '+(d.ordinal+1)+'</button></article>':'<article class="item"><div class="item-head"><strong>'+esc(d.title)+'</strong><span class="meta">'+d.chunkCount+' passages</span></div><p class="meta">'+esc(d.mediaType)+' · '+esc(d.embeddingStatus==='ready'?'Semantic index ready':d.embeddingStatus==='failed'?'Semantic indexing failed; keyword search available':d.embeddingStatus==='pending'?'Semantic indexing pending':'Keyword search available')+'</p>'+(d.embeddingStatus==='failed'?'<p class="meta">Check the embedding provider in Setup & settings, then retry indexing.</p>':'')+'<div class="actions"><button class="quiet" data-preview="'+esc(d.id)+'">Preview</button>'+(settingsSnapshot?.value.embeddingMode!=='fts'?'<button class="quiet" data-reindex="'+esc(d.id)+'">Retry indexing</button>':'')+'<button class="danger" data-remove="'+esc(d.id)+'">Remove</button></div></article>').join(''):'<div class="empty">'+(q?'No matching passages.':'Import a document to start your knowledge library.')+'</div>';
    msg(container,q?rows.length+' matching passages'+(rows.length===100?' (showing the first 100; narrow your search).':'.'):'');
    box.querySelectorAll('[data-preview]').forEach(button=>button.onclick=()=>action(button,container,()=>openPreview(button.dataset.preview,Number(button.dataset.ordinal||0))));
    box.querySelectorAll('[data-reindex]').forEach(button=>button.onclick=()=>action(button,container,async()=>{
      const d=rows.find(row=>row.id===button.dataset.reindex);msg(container,'Indexing '+d.title+'… Keyword search remains available.');
      try{await api('/knowledge/'+d.id+'/reindex',{method:'POST',body:JSON.stringify({expectedRevision:d.revision})})}finally{await loadKnowledge()}
    }));
    box.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>action(button,container,async()=>{
      const d=rows.find(row=>row.id===button.dataset.remove);if(!confirm('Remove this document and its index?'))return;
      await api('/knowledge/'+d.id,{method:'DELETE',body:JSON.stringify({expectedRevision:d.revision})});await Promise.all([loadKnowledge(),dashboard()]);
    }));
    document.querySelector('#knowledge-prev').disabled=!!q||knowledgeOffset===0;document.querySelector('#knowledge-next').disabled=!!q||rows.length<pageSize;
  }catch(error){if(request===knowledgeRequest)msg(container,error.message,true)}finally{if(request===knowledgeRequest)box.removeAttribute('aria-busy')}
}
async function openPreview(id,ordinal){
  const d=await api('/knowledge/'+id);previewDocument=d;previewMatch=ordinal;previewOffset=Math.floor(ordinal/10)*10;
  document.querySelector('#preview-title').textContent=d.title;document.querySelector('#preview-meta').textContent=(d.source.uri||d.source.kind)+' · '+d.chunkCount+' passages';
  document.querySelector('#knowledge-preview').showModal();await loadPreview();
}
async function loadPreview(){
  const request=++previewRequest,dialog=document.querySelector('#knowledge-preview'),box=document.querySelector('#preview-chunks');box.textContent='Loading passages…';msg(dialog,'');
  try{const chunks=await api('/knowledge/'+previewDocument.id+'/chunks?limit=10&offset='+previewOffset);if(request!==previewRequest)return;
    box.innerHTML=chunks.map(c=>'<section class="preview-chunk'+(c.ordinal===previewMatch?' match':'')+'"><strong>Passage '+(c.ordinal+1)+'</strong><p class="preview-text">'+esc(c.content)+'</p></section>').join('');
    document.querySelector('#preview-prev').disabled=previewOffset===0;document.querySelector('#preview-next').disabled=previewOffset+chunks.length>=previewDocument.chunkCount;
    if(previewMatch>0)box.querySelector('.match')?.scrollIntoView({block:'nearest'});
  }catch(error){if(request===previewRequest){box.textContent='';msg(dialog,error.message,true)}}
}
document.querySelector('#knowledge-search-form').onsubmit=event=>{event.preventDefault();knowledgeOffset=0;void loadKnowledge()};
document.querySelector('#knowledge-clear').onclick=()=>{document.querySelector('#knowledge-query').value='';knowledgeOffset=0;void loadKnowledge()};
document.querySelector('#knowledge-prev').onclick=()=>{knowledgeOffset=Math.max(0,knowledgeOffset-pageSize);void loadKnowledge()};
document.querySelector('#knowledge-next').onclick=()=>{knowledgeOffset+=pageSize;void loadKnowledge()};
document.querySelector('#preview-prev').onclick=()=>{previewOffset=Math.max(0,previewOffset-10);void loadPreview()};
document.querySelector('#preview-next').onclick=()=>{previewOffset+=10;void loadPreview()};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());

async function loadLearning(fill=true){
  const request=++learningRequest,container=document.querySelector('#learning-activity');
  try{const result=await api('/learning?offset='+learningOffset);if(request!==learningRequest)return;learningSnapshot=result.controls;
    const value=result.controls.value,form=document.querySelector('#learning-form');
    if(fill){form.elements.paused.checked=value.paused;form.elements.maxSessionTokens.value=value.maxSessionTokens;form.elements.maxDailyTokens.value=value.maxDailyTokens}
    form.querySelector('button').disabled=false;
    document.querySelector('#learning-summary').textContent=(value.paused?'Learning paused. ':'Learning enabled. ')+result.pendingTurns+' pending turns · '+result.dailyTokens+' / '+value.maxDailyTokens+' reported tokens today ('+result.day+' UTC).';
    document.querySelector('#learning-sessions').innerHTML=result.sessions.length?result.sessions.map(s=>'<article class="item"><strong>'+esc(s.sessionId)+'</strong><p class="meta">'+s.pendingTurns+' pending · '+s.tokens+' session tokens'+(s.lastError?' · '+esc(s.lastError.includes('token budget')?'Token budget exhausted':s.lastError.includes('No configured model')?'No session model available':'Processing interrupted or failed; will retry when eligible'):'')+'</p><button class="quiet" data-session="'+esc(s.sessionId)+'">'+(value.excludedSessionIds.includes(s.sessionId)?'Resume session':'Exclude session')+'</button></article>').join(''):'<div class="empty">No captured sessions yet.</div>';
    document.querySelector('#excluded-sessions').innerHTML=value.excludedSessionIds.map(id=>'<article class="item"><p>'+esc(id)+'</p><button class="quiet" data-session="'+esc(id)+'">Resume session</button></article>').join('');
    document.querySelectorAll('[data-session]').forEach(button=>button.onclick=()=>action(button,container,()=>toggleSession(button.dataset.session)));
    document.querySelector('#learning-prev').disabled=learningOffset===0;document.querySelector('#learning-next').disabled=learningOffset+50>=result.totalSessions;
    msg(container,'');
  }catch(error){if(request===learningRequest)msg(container,error.message,true)}
}
async function saveLearning(value){if(!learningSnapshot)throw new Error('Refresh learning controls first.');learningSnapshot=await api('/learning',{method:'PATCH',body:JSON.stringify({expectedRevision:learningSnapshot.revision,value})});await loadLearning()}
async function toggleSession(id){const value=learningSnapshot.value;await saveLearning({...value,excludedSessionIds:value.excludedSessionIds.includes(id)?value.excludedSessionIds.filter(item=>item!==id):[...value.excludedSessionIds,id]})}
document.querySelector('#learning-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;void action(form.querySelector('button'),form,async()=>{
  await saveLearning({...learningSnapshot.value,paused:form.elements.paused.checked,maxSessionTokens:Number(form.elements.maxSessionTokens.value),maxDailyTokens:Number(form.elements.maxDailyTokens.value)});msg(form,'Learning controls saved.');
})};
document.querySelector('#exclude-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;void action(form.querySelector('button'),form,async()=>{
  if(!learningSnapshot)throw new Error('Refresh learning controls first.');const id=form.elements.sessionId.value.trim();if(!id)throw new Error('Enter a session ID.');
  if(!learningSnapshot.value.excludedSessionIds.includes(id))await toggleSession(id);form.reset();msg(form,'Session excluded.');
})};
document.querySelector('#learning-refresh').onclick=()=>void loadLearning();
document.querySelector('#learning-prev').onclick=()=>{learningOffset=Math.max(0,learningOffset-50);void loadLearning()};
document.querySelector('#learning-next').onclick=()=>{learningOffset+=50;void loadLearning()};
`
