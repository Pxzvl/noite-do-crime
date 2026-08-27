// Dossiê Criminal — servidor local (zero dependências externas)
// Rode com: node server.js
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const CASES_DIR = path.join(__dirname, "cases");

/* =========================================================
   CARREGA TODOS OS CASOS DISPONÍVEIS
   ========================================================= */
const CASES = {}; // id -> caso completo
const CASE_ORDER = [];
fs.readdirSync(CASES_DIR).filter(f => f.endsWith(".json")).sort().forEach(f => {
  const data = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8"));
  CASES[data.id] = data;
  CASE_ORDER.push(data.id);
});
if (!CASE_ORDER.length) throw new Error("Nenhum caso encontrado em /cases");

function caseList() {
  return CASE_ORDER.map(id => {
    const c = CASES[id];
    return { id: c.id, title: c.title, difficulty: c.difficulty, synopsis: c.synopsis, minPlayers: c.minPlayers, maxPlayers: c.maxPlayers, estimatedMinutes: c.estimatedMinutes };
  });
}

/* =========================================================
   ESTADO DO JOGO (autoritativo, em memória — item 38 do design)
   ========================================================= */
function freshGame(caseId) {
  return {
    caseId: caseId || CASE_ORDER[0],
    phase: "lobby", // lobby | reveal | investigation | voting | result
    players: [],    // {id, name, characterId, ready, connected, joinedAt}
    actionsLeft: CASES[caseId || CASE_ORDER[0]].totalActions,
    discoveredEvidence: {}, // locId -> count
    publicFacts: [],
    declarations: {},       // charId -> {time: location}
    hintsGiven: [],         // ids already revealed
    votes: [],               // {playerId, voterName, accusedId, motive}
    characters: null,       // personagens desta partida (após sorteio da solução) — ver buildEffectiveCharacters
    solutionId: null,
    whatFooledYou: null
  };
}
let game = freshGame(CASE_ORDER[0]);
const streams = new Map(); // playerId -> res (SSE)

function currentCase() { return CASES[game.caseId]; }
function effChars() { return game.characters || currentCase().characters; }
function charById(id) { return effChars().find(c => c.id === id); }
function locById(id) { return currentCase().locations.find(l => l.id === id); }
function findPlayer(id) { return game.players.find(p => p.id === id); }

// Sorteia uma das soluções possíveis do caso (quem é o culpado e o motivo,
// nesta partida) e monta a lista de personagens "efetiva", com o culpado,
// o motivo e as posições/segredos ajustados de acordo com a solução sorteada.
function buildEffectiveCharacters(cs) {
  const solutions = cs.solutions && cs.solutions.length ? cs.solutions : [{ id: "a", default: true, murdererId: cs.characters.find(c => c.isMurderer).id }];
  const solution = solutions[Math.floor(Math.random() * solutions.length)];
  const clone = cs.characters.map(c => {
    const copy = JSON.parse(JSON.stringify(c));
    delete copy.isMurderer;
    return copy;
  });
  const murderer = clone.find(c => c.id === solution.murdererId);
  murderer.isMurderer = true;
  murderer.motive = solution.motive || murderer.motive;

  if (solution.characterOverrides) {
    Object.keys(solution.characterOverrides).forEach(charId => {
      const target = clone.find(c => c.id === charId);
      const ov = solution.characterOverrides[charId];
      if (!target || !ov) return;
      if (ov.segredo) target.segredo = ov.segredo;
      if (ov.objetivo) target.objetivo = ov.objetivo;
      if (ov.truth) Object.assign(target.truth, ov.truth);
    });
  }
  if (solution.witnessClues) {
    Object.keys(solution.witnessClues).forEach(holderId => {
      const holder = clone.find(c => c.id === holderId);
      if (!holder) return;
      holder.witnessClues = solution.witnessClues[holderId];
      delete holder.witnessClue;
    });
  }
  return { characters: clone, solutionId: solution.id, whatFooledYou: solution.whatFooledYou || null };
}

// Extrai o nome do local a partir de um texto de "truth" como "Escritório (fazendo algo)"
// ou "Escritório, fazendo algo" -> "Escritório". Usado para comparar declaração x verdade.
function truthLocation(str) {
  const parenIdx = str.indexOf(" (");
  const commaIdx = str.indexOf(", ");
  let idx = -1;
  if (parenIdx >= 0 && commaIdx >= 0) idx = Math.min(parenIdx, commaIdx);
  else idx = Math.max(parenIdx, commaIdx);
  return idx >= 0 ? str.slice(0, idx) : str;
}

/* =========================================================
   LÓGICA DE CONTRADIÇÃO (item 8 do design — não resolve, só aponta)
   ========================================================= */
function isWitnessRevealed(witnessChar, clue) {
  const loc = currentCase().locations.find(l => l.name === clue.where);
  if (!loc) return true;
  return (game.discoveredEvidence[loc.id] || 0) > 0;
}
function witnessClues(character) {
  if (!character.witnessClues && !character.witnessClue) return [];
  return character.witnessClues || [character.witnessClue];
}
function getContradictions() {
  const flags = [];
  effChars().forEach(c => {
    const decl = game.declarations[c.id] || {};
    effChars().forEach(w => {
      witnessClues(w).forEach(clue => {
        if (clue.about !== c.id) return;
        if (!isWitnessRevealed(w, clue)) return;
        const t = clue.time;
        if (decl[t] && decl[t] !== clue.where) {
          flags.push({ charId: c.id, charName: c.name, time: t, declared: decl[t], witness: w.name, saw: clue.where });
        }
      });
    });
  });
  return flags;
}

/* =========================================================
   DICAS
   ========================================================= */
function unlockedHintIds() {
  const cs = currentCase();
  const totalActionsUsed = cs.totalActions - game.actionsLeft;
  const contradictionsExist = getContradictions().length > 0;
  const ids = [];
  cs.hints.forEach(h => {
    if (h.unlockAfterActions !== undefined && totalActionsUsed >= h.unlockAfterActions) ids.push(h.id);
    if (h.unlockAfterLocation && (game.discoveredEvidence[h.unlockAfterLocation] || 0) > 0) ids.push(h.id);
    if (h.unlockOnContradiction && contradictionsExist) ids.push(h.id);
  });
  return ids;
}

/* =========================================================
   SNAPSHOT PERSONALIZADO POR JOGADOR
   ========================================================= */
function buildSnapshot(playerId) {
  const cs = currentCase();
  const me = findPlayer(playerId);
  const rosterVisible = game.phase !== "lobby";
  const roster = game.players.map(p => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    ready: p.ready,
    characterId: rosterVisible ? p.characterId : null,
    characterName: rosterVisible ? charById(p.characterId).name : null,
    characterRole: rosterVisible ? charById(p.characterId).role : null
  }));

  const snapshot = {
    phase: game.phase,
    availableCases: caseList(),
    caseInfo: {
      id: cs.id, title: cs.title, victim: cs.victim, intro: cs.intro, difficulty: cs.difficulty,
      minPlayers: cs.minPlayers, maxPlayers: cs.maxPlayers, estimatedMinutes: cs.estimatedMinutes,
      locations: cs.locations.map(l => ({ id: l.id, name: l.name, evidenceCount: l.evidence.length })),
      timeSlots: cs.timeSlots,
      characters: cs.characters.map(c => ({ id: c.id, name: c.name }))
    },
    players: roster,
    me: me ? { id: me.id, name: me.name, ready: me.ready, character: me.characterId ? charById(me.characterId) : null } : null
  };

  if (["investigation", "voting", "result"].includes(game.phase)) {
    const contradictions = getContradictions();
    snapshot.investigation = {
      actionsLeft: game.actionsLeft,
      totalActions: cs.totalActions,
      discoveredEvidence: game.discoveredEvidence,
      evidenceTexts: cs.locations.map(l => {
        const already = game.discoveredEvidence[l.id] || 0;
        const nextItem = l.evidence[already];
        let lockedOn = null;
        if (nextItem && nextItem.requires) {
          const req2 = nextItem.requires;
          const gotThere = (game.discoveredEvidence[req2.locationId] || 0) > req2.evidenceIndex;
          if (!gotThere) { const rl = locById(req2.locationId); lockedOn = rl ? rl.name : null; }
        }
        return { id: l.id, name: l.name, revealed: (l.evidence || []).slice(0, already), lockedOn };
      }),
      publicFacts: [...cs.timelinePublicSeed, ...game.publicFacts],
      declarations: game.declarations,
      contradictions,
      hints: unlockedHintIds().map(id => cs.hints.find(h => h.id === id).text)
    };
  }

  if (game.phase === "voting" || game.phase === "result") {
    snapshot.voting = {
      submitted: game.votes.map(v => v.voterName),
      myVoteSubmitted: !!game.votes.find(v => v.playerId === playerId),
      totalPlayers: game.players.length
    };
  }

  if (game.phase === "result") {
    const murderer = effChars().find(c => c.isMurderer);
    const correct = game.votes.filter(v => v.accusedId === murderer.id).length;
    const timelineReveal = effChars().map(c => ({
      charId: c.id,
      charName: c.name,
      slots: cs.timeSlots.map(t => {
        const declared = (game.declarations[c.id] || {})[t] || null;
        const truthLoc = truthLocation(c.truth[t]);
        return { time: t, declared, truth: c.truth[t], isLie: !!declared && declared !== truthLoc };
      })
    }));
    snapshot.result = {
      murderer: { name: murderer.name, role: murderer.role, motive: murderer.motive, truth: murderer.truth },
      votes: game.votes.map(v => ({ voter: v.voterName, accused: charById(v.accusedId).name, motive: v.motive, correct: v.accusedId === murderer.id })),
      correct, total: game.votes.length,
      pct: game.votes.length ? Math.round((correct / game.votes.length) * 100) : 0,
      whatFooledYou: game.whatFooledYou || cs.whatFooledYou,
      timelineReveal
    };
  }

  return snapshot;
}

function broadcast() {
  for (const [playerId, res] of streams.entries()) {
    try {
      res.write(`data: ${JSON.stringify(buildSnapshot(playerId))}\n\n`);
    } catch (e) { /* conexão morta, será limpa no 'close' */ }
  }
}

/* =========================================================
   ROTAS DE API
   ========================================================= */
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const api = {
  "/api/select-case": async (req, res, body) => {
    if (game.phase !== "lobby") return sendJSON(res, 409, { error: "Não dá pra trocar de caso com a partida em andamento." });
    if (!CASES[body.caseId]) return sendJSON(res, 404, { error: "Caso não encontrado." });
    const players = game.players.map(p => ({ id: p.id, name: p.name, characterId: null, ready: false, connected: p.connected, joinedAt: p.joinedAt, isBot: !!p.isBot }));
    game = freshGame(body.caseId);
    game.players = players;
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/join": async (req, res, body) => {
    let { playerId, name } = body;
    if (!playerId) playerId = crypto.randomUUID();
    name = (name || "").trim().slice(0, 24);
    let p = findPlayer(playerId);
    if (!p) {
      if (game.phase !== "lobby") {
        return sendJSON(res, 409, { error: "A partida já começou. Aguarde a próxima rodada." });
      }
      if (game.players.length >= currentCase().maxPlayers) {
        return sendJSON(res, 409, { error: "Sala cheia para este caso." });
      }
      p = { id: playerId, name: name || "Jogador", characterId: null, ready: false, connected: true, joinedAt: Date.now() };
      game.players.push(p);
    } else if (name) {
      p.name = name;
    }
    broadcast();
    sendJSON(res, 200, { playerId });
  },

  // modo teste solo — gesto escondido na sala de espera, preenche a sala com
  // jogadores fantasmas até o número exigido pelo caso, pra testar sozinho
  "/api/debug-fill-bots": async (req, res, body) => {
    if (game.phase !== "lobby") return sendJSON(res, 409, { error: "Só dá pra preencher com fantasmas na sala de espera." });
    const need = currentCase().maxPlayers - game.players.length;
    for (let i = 0; i < need; i++) {
      game.players.push({
        id: "bot-" + crypto.randomUUID(), name: `Fantasma ${i + 1}`,
        characterId: null, ready: false, connected: true, joinedAt: Date.now(), isBot: true
      });
    }
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/start": async (req, res, body) => {
    if (game.phase !== "lobby") return sendJSON(res, 409, { error: "Já iniciado." });
    if (game.players.length < currentCase().minPlayers) return sendJSON(res, 400, { error: `Mínimo de ${currentCase().minPlayers} jogadores.` });
    const eff = buildEffectiveCharacters(currentCase());
    game.characters = eff.characters;
    game.solutionId = eff.solutionId;
    game.whatFooledYou = eff.whatFooledYou;
    const shuffled = [...game.characters].sort(() => Math.random() - 0.5);
    game.players.forEach((p, i) => { p.characterId = shuffled[i % shuffled.length].id; p.ready = !!p.isBot; });
    // pré-preenche a linha do tempo com o álibi público de cada personagem,
    // pra ninguém começar sem saber o que a própria história diz
    game.characters.forEach(c => {
      if (!c.publicAlibi) return;
      game.declarations[c.id] = {};
      currentCase().timeSlots.forEach(t => { game.declarations[c.id][t] = c.publicAlibi; });
    });
    game.phase = "reveal";
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/ready": async (req, res, body) => {
    const p = findPlayer(body.playerId);
    if (!p) return sendJSON(res, 404, { error: "Jogador não encontrado." });
    p.ready = true;
    if (game.phase === "reveal" && game.players.every(pl => pl.ready)) {
      game.phase = "investigation";
    }
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/investigate": async (req, res, body) => {
    if (game.phase !== "investigation") return sendJSON(res, 409, { error: "Fora da fase de investigação." });
    const loc = locById(body.locationId);
    if (!loc) return sendJSON(res, 404, { error: "Local inválido." });
    const already = game.discoveredEvidence[loc.id] || 0;
    if (already >= loc.evidence.length) return sendJSON(res, 400, { error: "Local já totalmente investigado." });
    const nextItem = loc.evidence[already];
    if (nextItem.requires) {
      const req2 = nextItem.requires;
      const gotThere = (game.discoveredEvidence[req2.locationId] || 0) > req2.evidenceIndex;
      if (!gotThere) {
        const reqLoc = locById(req2.locationId);
        return sendJSON(res, 400, { error: `Ainda falta achar algo em ${reqLoc ? reqLoc.name : "outro local"} antes disso.` });
      }
    }
    if (game.actionsLeft <= 0) return sendJSON(res, 400, { error: "Sem ações restantes." });
    game.discoveredEvidence[loc.id] = already + 1;
    game.actionsLeft--;
    (loc.unlocksFacts || []).forEach(f => {
      if (!game.publicFacts.find(pf => pf.text === f.text)) game.publicFacts.push(f);
    });
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/declare": async (req, res, body) => {
    if (!["investigation", "voting"].includes(game.phase)) return sendJSON(res, 409, { error: "Fora da fase de declarações." });
    const { characterId, time, location } = body;
    if (!charById(characterId) || !currentCase().timeSlots.includes(time)) return sendJSON(res, 400, { error: "Dados inválidos." });
    game.declarations[characterId] = game.declarations[characterId] || {};
    if (location) game.declarations[characterId][time] = location;
    else delete game.declarations[characterId][time];
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/hint": async (req, res, body) => {
    const unlocked = unlockedHintIds();
    const next = unlocked.find(id => !game.hintsGiven.includes(id));
    if (next) game.hintsGiven.push(next);
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/goto-vote": async (req, res, body) => {
    if (game.phase !== "investigation") return sendJSON(res, 409, { error: "Fora da fase de investigação." });
    game.phase = "voting";
    // fantasmas votam sozinhos, escolhendo alguém ao acaso
    game.players.filter(p => p.isBot).forEach(p => {
      const options = effChars();
      const pick = options[Math.floor(Math.random() * options.length)];
      game.votes.push({ playerId: p.id, voterName: p.name, accusedId: pick.id, motive: "Palpite do fantasma de teste." });
    });
    if (game.votes.length >= game.players.length) game.phase = "result";
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/vote": async (req, res, body) => {
    if (game.phase !== "voting") return sendJSON(res, 409, { error: "Fora da fase de votação." });
    const p = findPlayer(body.playerId);
    if (!p) return sendJSON(res, 404, { error: "Jogador não encontrado." });
    if (!charById(body.accusedId)) return sendJSON(res, 400, { error: "Acusado inválido." });
    const existing = game.votes.find(v => v.playerId === p.id);
    const voteObj = { playerId: p.id, voterName: p.name, accusedId: body.accusedId, motive: (body.motive || "").trim().slice(0, 300) };
    if (existing) Object.assign(existing, voteObj); else game.votes.push(voteObj);
    if (game.votes.length >= game.players.length) game.phase = "result";
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/restart": async (req, res, body) => {
    const players = game.players.map(p => ({ id: p.id, name: p.name, characterId: null, ready: false, connected: p.connected, joinedAt: p.joinedAt, isBot: !!p.isBot }));
    game = freshGame(game.caseId);
    game.players = players;
    broadcast();
    sendJSON(res, 200, {});
  },

  "/api/back-to-menu": async (req, res, body) => {
    const players = game.players.map(p => ({ id: p.id, name: p.name, characterId: null, ready: false, connected: p.connected, joinedAt: p.joinedAt, isBot: !!p.isBot }));
    game = freshGame(CASE_ORDER[0]);
    game.players = players;
    broadcast();
    sendJSON(res, 200, {});
  }
};

/* =========================================================
   SSE (atualizações em tempo real)
   ========================================================= */
function handleStream(req, res, playerId) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("\n");
  streams.set(playerId, res);
  const p = findPlayer(playerId);
  if (p) p.connected = true;
  res.write(`data: ${JSON.stringify(buildSnapshot(playerId))}\n\n`);
  broadcast();

  const heartbeat = setInterval(() => { try { res.write(":hb\n\n"); } catch (e) {} }, 20000);
  req.on("close", () => {
    clearInterval(heartbeat);
    streams.delete(playerId);
    const pl = findPlayer(playerId);
    if (pl) pl.connected = false;
    broadcast();
  });
}

/* =========================================================
   ARQUIVOS ESTÁTICOS
   ========================================================= */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Não encontrado"); }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

/* =========================================================
   SERVIDOR HTTP
   ========================================================= */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === "/api/stream") {
    const playerId = u.searchParams.get("playerId");
    if (!playerId) { res.writeHead(400); return res.end("playerId obrigatório"); }
    return handleStream(req, res, playerId);
  }
  if (u.pathname.startsWith("/api/") && req.method === "POST") {
    const handler = api[u.pathname];
    if (!handler) return sendJSON(res, 404, { error: "Rota não encontrada." });
    try {
      const body = await readBody(req);
      return await handler(req, res, body);
    } catch (e) {
      return sendJSON(res, 400, { error: "Corpo inválido." });
    }
  }
  return serveStatic(req, res, u.pathname);
});

function localIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nDossiê Criminal rodando. ${CASE_ORDER.length} caso(s) carregado(s).`);
  console.log(`Neste aparelho: http://localhost:${PORT}`);
  const ips = localIPs();
  if (ips.length) {
    console.log(`Para os outros jogadores (mesma Wi-Fi/hotspot):`);
    ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  } else {
    console.log(`Não foi possível detectar o IP local automaticamente — veja o README.`);
  }
  console.log("");
});
