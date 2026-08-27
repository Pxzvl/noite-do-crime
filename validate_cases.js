const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'cases');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
let allOk = true;

files.forEach(f => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const errs = [];
  const charIds = data.characters.map(c => c.id);
  const locNames = data.locations.map(l => l.name);

  // player count deve bater exatamente com nº de personagens (evita bug de assassino não distribuído)
  if (data.minPlayers !== data.maxPlayers) errs.push(`minPlayers(${data.minPlayers}) != maxPlayers(${data.maxPlayers})`);
  if (data.characters.length !== data.maxPlayers) errs.push(`characters.length(${data.characters.length}) != maxPlayers(${data.maxPlayers})`);

  // exatamente um assassino/culpado
  const murderers = data.characters.filter(c => c.isMurderer);
  if (murderers.length !== 1) errs.push(`esperava 1 isMurderer, achou ${murderers.length}`);

  // cada personagem tem truth para todos os timeSlots, com localização válida (nome de local OU "Sala principal"/extra)
  data.characters.forEach(c => {
    data.timeSlots.forEach(t => {
      if (!c.truth || !c.truth[t]) errs.push(`${c.id} sem truth para ${t}`);
    });
    // witnessClue(s)
    const clues = c.witnessClues || (c.witnessClue ? [c.witnessClue] : []);
    clues.forEach(cl => {
      if (!charIds.includes(cl.about)) errs.push(`${c.id}.witnessClue.about='${cl.about}' não é um personagem válido`);
      if (!data.timeSlots.includes(cl.time)) errs.push(`${c.id}.witnessClue.time='${cl.time}' não está em timeSlots`);
      if (!locNames.includes(cl.where)) errs.push(`${c.id}.witnessClue.where='${cl.where}' não bate com nenhum local`);
    });
  });

  // ids de local únicos, evidence não vazia
  const locIds = data.locations.map(l => l.id);
  if (new Set(locIds).size !== locIds.length) errs.push('ids de locations duplicados');
  data.locations.forEach(l => {
    if (!l.evidence || !l.evidence.length) errs.push(`local ${l.id} sem evidence`);
    (l.evidence || []).forEach((ev, i) => {
      if (ev.requires) {
        if (!locIds.includes(ev.requires.locationId)) errs.push(`${l.id}[${i}].requires referencia local inválido '${ev.requires.locationId}'`);
        if (ev.requires.locationId === l.id) errs.push(`${l.id}[${i}].requires referencia o próprio local — evidência nunca destrava`);
      }
    });
  });

  // ids de personagem únicos
  if (new Set(charIds).size !== charIds.length) errs.push('ids de characters duplicados');

  // hints: unlockAfterLocation deve referenciar id de local válido
  (data.hints || []).forEach(h => {
    if (h.unlockAfterLocation && !locIds.includes(h.unlockAfterLocation)) errs.push(`hint ${h.id} referencia local inválido '${h.unlockAfterLocation}'`);
  });

  // campos obrigatórios de nível superior
  ['id','title','difficulty','synopsis','estimatedMinutes','victim','intro','minPlayers','maxPlayers','timeSlots','whatFooledYou','totalActions'].forEach(k => {
    if (data[k] === undefined) errs.push(`campo top-level ausente: ${k}`);
  });

  // soluções alternativas (múltiplos culpados possíveis no mesmo caso)
  if (data.solutions) {
    data.solutions.forEach(sol => {
      if (!charIds.includes(sol.murdererId)) { errs.push(`solução '${sol.id}': murdererId '${sol.murdererId}' inválido`); return; }
      // simula a montagem efetiva de personagens pra essa solução, igual o servidor faz
      const clone = data.characters.map(c => { const copy = JSON.parse(JSON.stringify(c)); delete copy.isMurderer; return copy; });
      const murderer = clone.find(c => c.id === sol.murdererId);
      murderer.isMurderer = true;
      if (sol.characterOverrides) {
        Object.keys(sol.characterOverrides).forEach(cid => {
          const target = clone.find(c => c.id === cid);
          if (!target) { errs.push(`solução '${sol.id}': characterOverrides referencia personagem inválido '${cid}'`); return; }
          const ov = sol.characterOverrides[cid];
          if (ov.truth) Object.assign(target.truth, ov.truth);
        });
      }
      if (sol.witnessClues) {
        Object.keys(sol.witnessClues).forEach(holderId => {
          const holder = clone.find(c => c.id === holderId);
          if (!holder) { errs.push(`solução '${sol.id}': witnessClues referencia personagem inválido '${holderId}'`); return; }
          holder.witnessClues = sol.witnessClues[holderId];
          delete holder.witnessClue;
        });
      }
      // reaplica as mesmas checagens de truth/witnessClue em cima do estado efetivo
      clone.forEach(c => {
        data.timeSlots.forEach(t => {
          if (!c.truth || !c.truth[t]) errs.push(`solução '${sol.id}': ${c.id} sem truth para ${t}`);
        });
        const clues = c.witnessClues || (c.witnessClue ? [c.witnessClue] : []);
        clues.forEach(cl => {
          if (!charIds.includes(cl.about)) errs.push(`solução '${sol.id}': ${c.id}.witnessClue.about='${cl.about}' inválido`);
          if (!data.timeSlots.includes(cl.time)) errs.push(`solução '${sol.id}': ${c.id}.witnessClue.time='${cl.time}' inválido`);
          if (!locNames.includes(cl.where)) errs.push(`solução '${sol.id}': ${c.id}.witnessClue.where='${cl.where}' inválido`);
        });
      });
    });
    const defaults = data.solutions.filter(s => s.default);
    if (defaults.length !== 1) errs.push(`esperava exatamente 1 solução default, achou ${defaults.length}`);
  }

  if (errs.length) {
    allOk = false;
    console.log(`❌ ${f}`);
    errs.forEach(e => console.log('   - ' + e));
  } else {
    console.log(`✅ ${f} (${data.title} — ${data.difficulty}, ${data.characters.length} personagens)`);
  }
});

console.log(allOk ? '\nTODOS OS CASOS VÁLIDOS' : '\nHÁ ERROS ACIMA');
process.exit(allOk ? 0 : 1);
