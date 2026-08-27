(function(){
"use strict";

/* =========================================================
   IDENTIDADE DO JOGADOR (persistida neste aparelho)
   ========================================================= */
let playerId = localStorage.getItem('dc_playerId');
if(!playerId){
  playerId = (crypto.randomUUID ? crypto.randomUUID() : 'p-'+Date.now()+'-'+Math.random().toString(16).slice(2));
  localStorage.setItem('dc_playerId', playerId);
}

let snapshot = null;
let ui = { activeTab:'personagem', error:'', stage:null, onboardingShownFor:null, hintsSeenCount:0 };
const app = document.getElementById('app');

/* =========================================================
   REDE
   ========================================================= */
function connect(){
  const es = new EventSource('/api/stream?playerId='+encodeURIComponent(playerId));
  es.onmessage = (ev)=>{
    snapshot = JSON.parse(ev.data);
    render();
  };
  es.onerror = ()=>{ /* o EventSource tenta reconectar sozinho */ };
}

async function post(url, body){
  try{
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) });
    if(!r.ok){
      const data = await r.json().catch(()=>({error:'Erro desconhecido.'}));
      ui.error = data.error || 'Não foi possível completar a ação.';
      render();
      setTimeout(()=>{ ui.error=''; render(); }, 3500);
      return false;
    }
    return true;
  }catch(e){
    ui.error = 'Sem conexão com o servidor.';
    render();
    return false;
  }
}

function playerCountLabel(c){
  return c.minPlayers === c.maxPlayers ? `${c.minPlayers} jogadores` : `${c.minPlayers}–${c.maxPlayers} jogadores`;
}
function difficultyDot(d){
  const map = { 'Fácil':'diff-facil', 'Médio':'diff-medio', 'Difícil':'diff-dificil' };
  return `<span class="diff-badge ${map[d]||''}">${d}</span>`;
}

/* =========================================================
   TUTORIAL (conteúdo estático, independe do caso)
   ========================================================= */
const TUTORIAL = [
  ["O que é isto", "Cada pessoa presente joga um personagem em segredo. Uma delas é a pessoa responsável pelo crime — só ela sabe disso."],
  ["Seu personagem", "Você recebe um objetivo, um segredo, relações com os outros e um álibi público — a história que seu personagem já conta sobre onde esteve. Você pode mudar essa história em voz alta, mas o aplicativo guarda o que já foi dito."],
  ["Investigação", "Cada local revela pistas aos poucos. As ações de investigação são limitadas e compartilhadas pelo grupo — usem com cuidado."],
  ["Declarações", "A linha do tempo já começa preenchida com o álibi de cada um. Na aba Pessoas, mudem o que quiserem, em voz alta, e atualizem os campos — isso fica público para todos."],
  ["Contradições", "Se uma declaração conflitar com algo que uma testemunha já revelou, o app aponta a contradição — mas nunca diz quem está mentindo. Isso é com vocês."],
  ["Dicas", "Se o grupo travar, peçam uma dica na aba Dicas. Elas indicam para onde olhar, nunca a solução."],
  ["Votação", "No final, cada jogador acusa alguém e explica o motivo. Só depois de todos votarem o app revela a verdade — inclusive quem mentiu em cada horário."]
];

function renderTutorialOverlay(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card pop-in">
      <div class="meta">Como jogar</div>
      <h2>Guia rápido</h2>
      ${TUTORIAL.map(([t,d],i)=>`<div class="fade-in" style="animation-delay:${i*0.05}s"><h3>${t}</h3><p>${d}</p></div>`).join('')}
      <button class="btn primary" id="closeTut" style="margin-top:10px;">Entendi</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeTut').onclick = ()=> overlay.remove();
}

/* =========================================================
   TELA DE TÍTULO
   ========================================================= */
function renderTitleScreen(){
  app.innerHTML = '';
  const hasPlayers = snapshot.players.length > 0;
  const wrap = document.createElement('div');
  wrap.className = 'title-screen fade-in';
  wrap.innerHTML = `
    <div class="title-topline">ARQUIVO CENTRAL DE INVESTIGAÇÕES</div>
    <div class="title-stampwrap"><div class="stamp title-stamp">Confidencial</div></div>
    <h1 class="title-main">DOSSIÊ<br>CRIMINAL</h1>
    <div class="title-rule"></div>
    <p class="title-sub">Um crime. Um punhado de suspeitos. Uma verdade escondida em algum lugar entre o que foi dito e o que realmente aconteceu.</p>
    <div class="title-menu">
      <button class="btn primary" id="menuEnter">${hasPlayers ? ('Entrar em "'+snapshot.caseInfo.title+'"') : 'Escolher um caso'}</button>
      ${hasPlayers ? '<button class="btn ghost" id="menuChange">Trocar de caso</button>' : ''}
      <button class="btn ghost" id="menuTutorial">Como jogar</button>
    </div>
    <p class="small center" style="margin-top:18px;">${snapshot ? (snapshot.availableCases.length+' casos disponíveis') : 'Conectando ao servidor...'}</p>
  `;
  app.appendChild(wrap);
  const enterBtn = wrap.querySelector('#menuEnter');
  if(!snapshot) enterBtn.disabled = true;
  enterBtn.onclick = ()=>{ ui.stage = hasPlayers ? 'game' : 'picker'; render(); };
  const changeBtn = wrap.querySelector('#menuChange');
  if(changeBtn) changeBtn.onclick = ()=>{ ui.stage = 'picker'; render(); };
  wrap.querySelector('#menuTutorial').onclick = renderTutorialOverlay;
}

/* =========================================================
   TELA DE SELEÇÃO DE CASO
   ========================================================= */
function renderCasePicker(){
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'picker-screen';
  wrap.innerHTML = `
    <div class="casebar"><span class="tag">Dossiê Criminal</span><span class="num">ARQUIVO DE CASOS</span><span class="help" id="helpBtn">?</span></div>
    <main>
      <div class="eyebrow fade-in">Passo 1</div>
      <h2 class="fade-in">Escolha o caso de hoje</h2>
      <p class="small fade-in">O caso escolhido vale para toda a sala — quem já estiver esperando também vê a troca.</p>
      <div id="caseCards"></div>
    </main>
  `;
  app.appendChild(wrap);
  wrap.querySelector('#helpBtn').onclick = renderTutorialOverlay;
  const cardsWrap = wrap.querySelector('#caseCards');
  snapshot.availableCases.forEach((c,i)=>{
    const isActive = snapshot.caseInfo.id === c.id;
    const card = document.createElement('div');
    card.className = 'card case-card fade-in';
    card.style.animationDelay = (i*0.05)+'s';
    card.innerHTML = `
      <div class="meta">Caso ${String(i+1).padStart(3,'0')}</div>
      <h2>${c.title}</h2>
      ${difficultyDot(c.difficulty)}
      <p style="margin-top:10px;">${c.synopsis}</p>
      <p class="small">${playerCountLabel(c)} · ~${c.estimatedMinutes} min</p>
      <button class="btn ${isActive ? 'primary' : 'ghost'}" data-case="${c.id}">${isActive ? 'Caso selecionado ✓' : 'Escolher este caso'}</button>
    `;
    cardsWrap.appendChild(card);
  });
  cardsWrap.querySelectorAll('button[data-case]').forEach(btn=>{
    btn.onclick = async ()=>{
      const ok = await post('/api/select-case', { caseId: btn.dataset.case });
      if(ok){ ui.stage = 'game'; render(); }
    };
  });
}

/* =========================================================
   RENDER RAIZ
   ========================================================= */
function render(){
  if(!snapshot){
    app.innerHTML = '<div class="title-screen"><p class="small">Conectando ao servidor...</p></div>';
    return;
  }

  if(ui.stage === null){
    // primeira renderização: decide o ponto de partida deste aparelho
    ui.stage = snapshot.me ? 'game' : 'title';
  }

  if(ui.stage === 'title'){ renderTitleScreen(); return; }
  if(ui.stage === 'picker'){ renderCasePicker(); return; }

  app.innerHTML = '';
  const bar = document.createElement('div');
  bar.className = 'casebar';
  const idx = snapshot.availableCases.findIndex(c=>c.id===snapshot.caseInfo.id);
  const num = idx >= 0 ? String(idx+1).padStart(3,'0') : '001';
  bar.innerHTML = `<span class="tag">Dossiê Criminal</span><span class="num">CASO ${num} / ${snapshot.caseInfo.title.toUpperCase()}</span><span class="help" id="helpBtn">?</span>`;
  app.appendChild(bar);
  bar.querySelector('#helpBtn').onclick = renderTutorialOverlay;

  const main = document.createElement('main');
  app.appendChild(main);

  if(ui.error){
    const b = document.createElement('div');
    b.className = 'banner err fade-in';
    b.textContent = ui.error;
    main.appendChild(b);
  }

  if(!snapshot.me){ renderJoin(main); return; }

  const screens = {
    lobby: renderLobby,
    reveal: renderReveal,
    investigation: renderHub,
    voting: renderVoting,
    result: renderResult
  };
  (screens[snapshot.phase] || renderLobby)(main);
}

/* ---------------- ENTRAR NA SALA ---------------- */
function renderJoin(main){
  main.innerHTML += `
    <div class="eyebrow fade-in">Arquivo confidencial</div>
    <h1 class="fade-in">${snapshot.caseInfo.title}</h1>
    ${difficultyDot(snapshot.caseInfo.difficulty)}
    <p class="fade-in" style="margin-top:10px;">${snapshot.caseInfo.intro}</p>
    <div class="card fade-in">
      <div class="field-label">Seu nome</div>
      <input type="text" id="nameInput" placeholder="Como te chamam na mesa">
    </div>
    <div class="btn-row">
      <button class="btn primary" id="joinBtn">Entrar no caso</button>
    </div>
    <p class="small">${playerCountLabel(snapshot.caseInfo)} · todos conectados na mesma Wi-Fi/hotspot.</p>
  `;
  main.querySelector('#joinBtn').onclick = async ()=>{
    const name = main.querySelector('#nameInput').value.trim();
    if(!name) { ui.error='Digite um nome.'; render(); setTimeout(()=>{ui.error='';render();},2500); return; }
    await post('/api/join', { playerId, name });
  };
}

/* ---------------- LOBBY ---------------- */
function renderLobby(main){
  const n = snapshot.players.length;
  const min = snapshot.caseInfo.minPlayers;
  const max = snapshot.caseInfo.maxPlayers;
  const canStart = n >= min && n <= max;
  main.innerHTML += `
    <div class="eyebrow fade-in" id="lobbyEyebrow">Sala de espera</div>
    <h2 class="fade-in">${snapshot.caseInfo.title}</h2>
    ${difficultyDot(snapshot.caseInfo.difficulty)}
    <div class="card fade-in" style="margin-top:14px;">
      <div class="meta">Briefing do caso</div>
      <div class="field-label">Vítima</div><p>${snapshot.caseInfo.victim}</p>
      <div class="field-label">O que se sabe até agora</div><p>${snapshot.caseInfo.intro}</p>
      <p class="small">${playerCountLabel(snapshot.caseInfo)} · ~${snapshot.caseInfo.estimatedMinutes} min</p>
    </div>
    <div class="card fade-in" id="roster"></div>
    <p class="small">${n < min ? `Aguardando mais jogadores (mínimo ${min}).` : (n > max ? `Esse caso aceita no máximo ${max} jogadores.` : `Prontos para começar — este caso precisa de exatamente ${max} jogadores.`)}</p>
    <div class="btn-row">
      <button class="btn primary" id="startBtn" ${canStart && n===max ? '' : 'disabled'}>Começar investigação</button>
    </div>
    <div class="btn-row">
      <button class="btn ghost" id="changeCaseBtn">Trocar de caso</button>
    </div>
  `;
  const roster = main.querySelector('#roster');
  roster.innerHTML = `<div class="meta">Jogadores conectados</div>` + snapshot.players.map((p,i)=>
    `<div class="list-item fade-in" style="animation-delay:${i*0.05}s"><span class="name">${p.isBot?'👻 ':''}${p.name}</span><span class="pill ${p.connected?'found':'warn'}">${p.connected?'online':'offline'}</span></div>`
  ).join('');
  main.querySelector('#startBtn').onclick = ()=> post('/api/start', { playerId });
  main.querySelector('#changeCaseBtn').onclick = ()=>{ ui.stage = 'picker'; render(); };

  // modo teste solo: 5 toques rápidos no título da sala preenchem a sala com fantasmas
  let tapCount = 0, tapTimer = null;
  main.querySelector('#lobbyEyebrow').onclick = ()=>{
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(()=>{ tapCount = 0; }, 1800);
    if(tapCount >= 5){
      tapCount = 0;
      post('/api/debug-fill-bots', {});
    }
  };
}

/* ---------------- REVELAÇÃO ---------------- */
const MURDERER_TIPS = [
  'Mantenham a mesma versão sempre — repetir a história igual é mais convincente do que repetir "sem querer" um detalhe novo.',
  'Se apontarem uma contradição em vocês, não entrem em pânico. Tenham pronta uma explicação simples ("me confundi de horário", "foi rápido, mal reparei").',
  'Desconfiar em voz alta de outra pessoa é uma boa forma de tirar atenção de vocês.',
  'Evitem parecer saber demais sobre algo que o personagem de vocês não deveria ter visto.',
  'Mudar a própria declaração no meio do jogo é permitido, mas só funciona bem se vier com um motivo que explique a mudança.'
];

function characterCardHTML(c, opts){
  opts = opts || {};
  const murderer = !!c.isMurderer;
  const cardClass = murderer ? 'card pop-in murderer-card' : 'card' + (opts.animated ? ' pop-in' : '');
  let html = `<div class="${cardClass}">`;
  if(murderer){
    html += `<div class="murderer-banner">🔪 Você é o culpado — só você sabe disso</div>`;
  }
  html += `
    <div class="meta">${opts.metaLabel || 'Sua identidade'}</div>
    <h2>${c.name}</h2>
    <h3>${c.role}</h3>
    <div class="field-label">Objetivo</div><p>${c.objetivo}</p>
    <div class="field-label">Segredo</div><p>${c.segredo}</p>
    <div class="field-label">Relações conhecidas</div><p>${c.relacoes.join(' · ')}</p>
    <div class="field-label">${opts.alibiLabel || 'Seu álibi público (o que você já diz)'}</div>
    <p>Você afirma que ficou em <b>${c.publicAlibi}</b> a noite inteira.${opts.alibiHint || ''}</p>
  `;
  if(murderer){
    html += `
      <div class="field-label">Como mentir bem</div>
      <ul class="murderer-tips">${MURDERER_TIPS.map(t=>`<li>${t}</li>`).join('')}</ul>
    `;
  }
  html += `</div>`;
  return html;
}

function renderReveal(main){
  const me = snapshot.me;
  if(!me.ready){
    const c = me.character;
    main.innerHTML += `
      <div class="stamp">Confidencial</div>
      ${characterCardHTML(c, { alibiHint: ' É a sua história — pode mudar em qualquer horário durante o jogo, na aba Pessoas.' })}
      <p class="small">Memorize essas informações. Você pode mentir sobre elas durante o jogo — mas não pode inventar fatos que o aplicativo já registrou.</p>
      <div class="btn-row">
        <button class="btn primary" id="readyBtn">Memorizei — entrar na investigação</button>
      </div>
    `;
    main.querySelector('#readyBtn').onclick = ()=> post('/api/ready', { playerId });
  } else {
    main.innerHTML += `
      <div class="eyebrow fade-in">Aguardando o grupo</div>
      <h2 class="fade-in">Todo mundo precisa estar pronto</h2>
      <div class="card fade-in">
        ${snapshot.players.map((p,i)=>`<div class="list-item fade-in" style="animation-delay:${i*0.05}s"><span class="name">${p.name}</span><span class="pill ${p.ready?'found':'wait'}">${p.ready?'pronto':'lendo...'}</span></div>`).join('')}
      </div>
    `;
  }
}

/* ---------------- HUB DE INVESTIGAÇÃO ---------------- */
function computeGuidance(inv){
  if (inv.actionsLeft <= 0) return { icon:'🗳️', text:'Sem mais ações de investigação. Fechem a teoria do grupo e partam para a votação.' };
  if (inv.contradictions.length > 0) return { icon:'⚠️', text:'Encontraram uma contradição — vejam a Linha do tempo e decidam se ela aponta pro crime ou é só outro segredo sendo escondido.' };
  const investigatedAny = Object.keys(inv.discoveredEvidence).length > 0;
  if (!investigatedAny) return { icon:'🔎', text:'Comecem investigando um local, na aba Locais.' };
  return { icon:'🔎', text:'Continuem investigando locais, ou revisem o que cada personagem diz na aba Pessoas.' };
}

function renderHub(main){
  const tabs = [
    ['personagem','Elenco'],
    ['locais','Locais'],
    ['pessoas','Pessoas'],
    ['evidencias','Evidências'],
    ['tempo','Linha do tempo'],
    ['dicas','Dicas']
  ];
  const inv = snapshot.investigation;
  const contradictionCount = inv.contradictions.length;
  const hintsAvailable = inv.hints.length > ui.hintsSeenCount;

  if (ui.onboardingShownFor !== snapshot.caseInfo.id){
    ui.onboardingShownFor = snapshot.caseInfo.id;
    renderOnboardingOverlay();
  }

  const guidance = computeGuidance(inv);
  const gBar = document.createElement('div');
  gBar.className = 'guidance-bar fade-in';
  gBar.innerHTML = `
    <div class="guidance-text"><span class="gicon">${guidance.icon}</span> ${guidance.text}</div>
    <div class="guidance-stats">
      <span>${Object.values(inv.discoveredEvidence).reduce((a,b)=>a+b,0)} pista(s) encontradas</span>
      <span>${contradictionCount} contradição(ões)</span>
      <span>${inv.actionsLeft}/${inv.totalActions} ações</span>
    </div>
  `;
  main.appendChild(gBar);

  const tabBar = document.createElement('div');
  tabBar.className = 'tabs';
  tabBar.innerHTML = tabs.map(([id,label])=>
    `<div class="tab ${ui.activeTab===id?'active':''}" data-tab="${id}">${label}${id==='tempo' && contradictionCount ? '<span class="dot"></span>':''}${id==='dicas' && hintsAvailable ? '<span class="dot brass"></span>':''}</div>`
  ).join('');
  main.appendChild(tabBar);
  tabBar.querySelectorAll('.tab').forEach(t=> t.onclick = ()=>{
    if(ui.activeTab!==t.dataset.tab){ ui.activeTab = t.dataset.tab; render(); }
  });

  const body = document.createElement('div');
  body.className = 'tab-body fade-in';
  body.style.marginTop = '16px';
  body.style.padding = '0 18px';
  main.appendChild(body);

  const renderers = { personagem:tabElenco, locais:tabLocais, pessoas:tabPessoas, evidencias:tabEvidencias, tempo:tabTempo, dicas:tabDicas };
  renderers[ui.activeTab](body);

  const footer = document.createElement('footer');
  footer.className = 'actions';
  footer.innerHTML = `<button class="btn ghost" id="toVote">Encerrar investigação e votar →</button>`;
  main.appendChild(footer);
  footer.querySelector('#toVote').onclick = ()=>{
    if(confirm('Encerrar a investigação para todo o grupo e ir para a votação?')){
      post('/api/goto-vote', { playerId });
    }
  };
}

function renderOnboardingOverlay(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="card pop-in">
      <div class="meta">Investigação começou</div>
      <h2>O que fazer agora</h2>
      <div class="onboard-step"><span class="onum">1</span><p><b>Investiguem locais.</b> Cada um libera pistas aos poucos — as ações são limitadas e compartilhadas por todo o grupo.</p></div>
      <div class="onboard-step"><span class="onum">2</span><p><b>Conversem em voz alta.</b> Cada personagem já tem uma versão pronta na aba Pessoas — mudem o que quiserem, mentindo ou não.</p></div>
      <div class="onboard-step"><span class="onum">3</span><p><b>Fiquem de olho em contradições.</b> Quando duas versões não baterem, o jogo avisa — mas quem está mentindo é com vocês.</p></div>
      <div class="onboard-step"><span class="onum">4</span><p><b>Travou?</b> Peçam uma dica na última aba. Elas indicam onde olhar, nunca quem é o culpado.</p></div>
      <button class="btn primary" id="closeOnboard" style="margin-top:10px;">Entendi, vamos nessa</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeOnboard').onclick = ()=> overlay.remove();
}

function tabElenco(body){
  const me = snapshot.me;
  body.innerHTML = characterCardHTML(me.character, { alibiLabel:'Seu álibi público' }) + `
    <div class="card">
      <div class="meta">Elenco desta partida</div>
      ${snapshot.players.map(p=>`<div class="list-item"><span class="name">${p.name}${p.id===me.id?' (você)':''}</span><span class="sub">${p.characterName}</span></div>`).join('')}
    </div>
  `;
}

function tabLocais(body){
  const inv = snapshot.investigation;
  const ap = document.createElement('div');
  ap.className = 'card';
  ap.innerHTML = `<div class="meta">Ações de investigação restantes (grupo)</div><span class="ap-counter">${inv.actionsLeft} / ${inv.totalActions}</span>`;
  body.appendChild(ap);

  inv.evidenceTexts.forEach(loc=>{
    const meta = snapshot.caseInfo.locations.find(l=>l.id===loc.id);
    const revealedCount = loc.revealed.length;
    const card = document.createElement('div');
    card.className = 'card';
    let html = `<div class="meta">Local</div><h2>${loc.name}</h2>`;
    loc.revealed.forEach((ev,i)=>{
      html += `<div class="evidence-block reveal-pop" style="animation-delay:${i*0.06}s"><span class="tag">${ev.tag}</span><p style="margin-top:4px;">${ev.text}</p></div>`;
    });
    if(revealedCount < meta.evidenceCount){
      if(loc.lockedOn){
        html += `<div class="locked-hint">🔒 Tem algo aqui, mas só faz sentido depois de investigarem <b>${loc.lockedOn}</b>.</div>`;
      } else {
        html += `<button class="btn ghost" data-loc="${loc.id}" ${inv.actionsLeft<=0?'disabled':''}>Investigar (−1 ação)</button>`;
      }
    } else {
      html += `<p class="small">Local totalmente investigado.</p>`;
    }
    card.innerHTML = html;
    body.appendChild(card);
  });

  body.querySelectorAll('button[data-loc]').forEach(btn=>{
    btn.onclick = ()=>{
      btn.classList.add('btn-press');
      post('/api/investigate', { locationId: btn.dataset.loc });
    };
  });
}

function tabPessoas(body){
  const inv = snapshot.investigation;
  body.innerHTML = `<p class="small">Registrem em voz alta o que cada personagem afirma, e usem os campos abaixo para deixar a declaração oficial.</p>`;
  const extraOption = 'Sala principal';
  snapshot.players.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'card';
    let html = `<div class="meta">Personagem</div><h2>${p.characterName}</h2><h3>${p.characterRole}</h3>`;
    snapshot.caseInfo.timeSlots.forEach(t=>{
      const declared = (inv.declarations[p.characterId] || {})[t] || '';
      html += `<div class="field-label">Onde estava às ${t}?</div>
        <select data-char="${p.characterId}" data-time="${t}">
          <option value="">— sem declaração —</option>
          ${snapshot.caseInfo.locations.map(l=>`<option value="${l.name}" ${declared===l.name?'selected':''}>${l.name}</option>`).join('')}
          <option value="${extraOption}" ${declared===extraOption?'selected':''}>${extraOption}</option>
        </select>`;
    });
    card.innerHTML = html;
    body.appendChild(card);
  });
  body.querySelectorAll('select[data-char]').forEach(sel=>{
    sel.onchange = ()=> post('/api/declare', { characterId: sel.dataset.char, time: sel.dataset.time, location: sel.value });
  });

  if(inv.contradictions.length){
    const box = document.createElement('div');
    box.className = 'contradiction pulse-warn';
    box.innerHTML = `⚠️ ${inv.contradictions.length} contradição(ões) detectada(s) — veja a Linha do tempo.`;
    body.appendChild(box);
  }
}

function tabEvidencias(body){
  const inv = snapshot.investigation;
  let any = false;
  inv.evidenceTexts.forEach(loc=>{
    if(!loc.revealed.length) return;
    any = true;
    const card = document.createElement('div');
    card.className = 'card';
    let html = `<div class="meta">${loc.name}</div>`;
    loc.revealed.forEach(ev=> html += `<div class="evidence-block"><span class="tag">${ev.tag}</span><p style="margin-top:4px;">${ev.text}</p></div>`);
    card.innerHTML = html;
    body.appendChild(card);
  });
  if(!any) body.innerHTML = `<p class="small">Nenhuma evidência encontrada ainda. Vá até a aba Locais para investigar.</p>`;
}

function tabTempo(body){
  const inv = snapshot.investigation;
  body.innerHTML = `<div class="card"><div class="meta">Linha do tempo pública</div></div>`;
  const table = document.createElement('table');
  let rows = `<tr><th>Hora</th>${snapshot.players.map(p=>`<th>${p.characterName.split(' ')[0]}</th>`).join('')}</tr>`;
  snapshot.caseInfo.timeSlots.forEach(t=>{
    rows += `<tr><td>${t}</td>`;
    snapshot.players.forEach(p=>{
      const decl = (inv.declarations[p.characterId]||{})[t] || '—';
      const conflict = inv.contradictions.find(f=>f.charId===p.characterId && f.time===t);
      rows += `<td class="${conflict?'confl':''}">${decl}</td>`;
    });
    rows += `</tr>`;
  });
  table.innerHTML = rows;
  body.appendChild(table);

  inv.contradictions.forEach(f=>{
    const box = document.createElement('div');
    box.className = 'contradiction pulse-warn';
    box.innerHTML = `⚠️ ${f.charName} declarou estar em <b>${f.declared}</b> às ${f.time}, mas ${f.witness} afirma tê-lo visto em <b>${f.saw}</b> nesse horário.`;
    body.appendChild(box);
  });

  const pub = document.createElement('div');
  pub.className = 'card';
  pub.style.marginTop = '14px';
  let html = `<div class="meta">Fatos públicos registrados</div>`;
  inv.publicFacts.forEach(f=> html += `<p>${f.time} — ${f.text}</p>`);
  pub.innerHTML = html;
  body.appendChild(pub);
}

function tabDicas(body){
  const inv = snapshot.investigation;
  ui.hintsSeenCount = inv.hints.length;
  body.innerHTML = `<p class="small">Dicas indicam para onde olhar — nunca quem é o culpado.</p>`;
  if(!inv.hints.length){
    body.innerHTML += `<p class="small">Nenhuma dica pedida ainda.</p>`;
  } else {
    inv.hints.forEach((h,i)=>{
      const box = document.createElement('div');
      box.className = 'hint-block reveal-pop';
      box.style.animationDelay = (i*0.06)+'s';
      box.innerHTML = `<span class="tag">Dica ${i+1}</span>${h}`;
      body.appendChild(box);
    });
  }
  const btn = document.createElement('button');
  btn.className = 'btn ghost';
  btn.style.marginTop = '14px';
  btn.textContent = 'Pedir dica';
  btn.onclick = ()=> post('/api/hint', {});
  body.appendChild(btn);
}

/* ---------------- VOTAÇÃO ---------------- */
function renderVoting(main){
  const v = snapshot.voting;
  if(v.myVoteSubmitted){
    main.innerHTML += `
      <div class="eyebrow fade-in">Voto registrado</div>
      <h2 class="fade-in">Aguardando o restante do grupo</h2>
      <div class="card fade-in">
        ${snapshot.players.map((p,i)=>`<div class="list-item fade-in" style="animation-delay:${i*0.05}s"><span class="name">${p.name}</span><span class="pill ${v.submitted.includes(p.name)?'found':'wait'}">${v.submitted.includes(p.name)?'votou':'votando...'}</span></div>`).join('')}
      </div>
    `;
    return;
  }
  main.innerHTML += `
    <div class="eyebrow fade-in">Voto final</div>
    <h2 class="fade-in">Quem você acusa?</h2>
    <div class="field-label">Acusado</div>
    <select id="accused">
      ${snapshot.caseInfo.characters.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
    </select>
    <div class="field-label">Motivo (sua teoria)</div>
    <textarea id="motive" placeholder="Por que você acha que foi essa pessoa?"></textarea>
    <div class="btn-row">
      <button class="btn primary" id="submitVote">Registrar voto</button>
    </div>
  `;
  main.querySelector('#submitVote').onclick = ()=> post('/api/vote', {
    playerId, accusedId: main.querySelector('#accused').value, motive: main.querySelector('#motive').value.trim()
  });
}

/* ---------------- RESULTADO ---------------- */
function renderResult(main){
  const r = snapshot.result;
  main.innerHTML += `
    <div class="eyebrow fade-in">Investigação encerrada</div>
    <div class="stamp">Caso encerrado</div>
    <div class="card pop-in" style="margin-top:14px;">
      <div class="meta">O verdadeiro culpado era</div>
      <h1>${r.murderer.name}</h1><h3>${r.murderer.role}</h3>
      <div class="field-label">Motivo real</div><p>${r.murderer.motive}</p>
    </div>
    <div class="card fade-in">
      <div class="meta">O que realmente aconteceu</div>
      ${snapshot.caseInfo.timeSlots.map(t=>`<p><b>${t}</b> — ${r.murderer.truth[t]}</p>`).join('')}
    </div>
    <div class="card fade-in">
      <div class="meta">Votação do grupo</div>
      ${r.votes.map((v,i)=>`<div class="list-item fade-in" style="animation-delay:${i*0.05}s"><span class="name">${v.voter} acusou ${v.accused}</span><span class="pill ${v.correct?'found':'warn'}">${v.correct?'acertou':'errou'}</span></div>`).join('')}
      <h2 style="margin-top:14px;">${r.correct}/${r.total} acertaram (${r.pct}%)</h2>
    </div>
    <div class="card fade-in">
      <div class="meta">Quem mentiu, e onde</div>
      <p class="small" style="margin-bottom:10px;">Comparação entre o que cada um disse por último e o que aconteceu de verdade.</p>
      <div id="revealTable"></div>
    </div>
    <div class="card fade-in">
      <div class="meta">O que te enganou</div>
      ${r.whatFooledYou.map(t=>`<p>${t}</p>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn primary" id="restart">Jogar de novo (mesmo caso)</button>
    </div>
    <div class="btn-row">
      <button class="btn ghost" id="backMenu">Escolher outro caso</button>
    </div>
  `;
  const revealWrap = main.querySelector('#revealTable');
  r.timelineReveal.forEach(cRev=>{
    const table = document.createElement('table');
    table.style.marginBottom = '14px';
    let rows = `<tr><th colspan="2">${cRev.charName}</th></tr>`;
    cRev.slots.forEach(s=>{
      const declaredText = s.declared || '— não declarou —';
      const flag = s.declared ? (s.isLie ? '🔴 mentira' : '🟢 verdade') : '';
      rows += `<tr><td>${s.time} — disse: ${declaredText}</td><td class="${s.isLie?'confl':''}">${flag}</td></tr>`;
    });
    table.innerHTML = rows;
    revealWrap.appendChild(table);
  });
  main.querySelector('#restart').onclick = ()=> post('/api/restart', {});
  main.querySelector('#backMenu').onclick = async ()=>{
    await post('/api/back-to-menu', {});
    ui.stage = 'picker';
    render();
  };
}

connect();
render();
})();
