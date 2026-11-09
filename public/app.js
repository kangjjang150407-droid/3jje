/* 몬스터 카드 배틀 - 클라이언트 */
(() => {
  'use strict';
  const socket = io({ transports: ['websocket', 'polling'] });
  const $app = document.getElementById('app');
  const LS_T = 'mcb_teacher', LS_S = 'mcb_student';

  let DB = null; // 카드 데이터
  let state = null;
  let role = null; // 'teacher' | 'student' | null
  let selected = null; // 선택한 카드 uid
  let target = null; // 선택한 대상 팀
  let deadlineAt = 0;
  let layoutKey = '';
  let lastEventsKey = '';

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const save = (k, v) => (v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k));

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2500);
  }
  const emit = (ev, data) => new Promise(res => socket.emit(ev, data, r => { if (r && r.error) toast(r.error); res(r || {}); }));

  // 컨테이너 내용이 바뀔 때만 다시 그림 (입력/선택창 유지)
  function patch(id, html) {
    const el = document.getElementById(id);
    if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
  }
  function layout(key, html) {
    if (layoutKey !== key) { $app.innerHTML = html; layoutKey = key; }
  }

  // ===== 카드 그리기 =====
  function cardHTML(inst, opts = {}) {
    const c = DB.map[inst.cardId];
    const elCls = c.type === 'spell' ? 'el-spell' : 'el-' + c.el;
    const ab = c.abil ? `<div class="ab" title="${esc(DB.abilities[c.abil].desc)}">${DB.abilities[c.abil].name}</div>` : '';
    const body = c.type === 'spell'
      ? `<div class="desc">${esc(c.desc)}</div>`
      : `${ab}<div class="stats"><span class="a">⚔${c.atk}</span><span class="h">❤${c.hp}</span></div>`;
    const cls = ['card', elCls, opts.hand ? 'hand' : '', opts.sel ? 'sel' : '', opts.nomana ? 'nomana' : ''].join(' ');
    return `<div class="${cls}" ${opts.hand ? `data-act="select" data-uid="${inst.uid}"` : ''}>
      <div class="cost">${c.cost}</div>
      ${c.type === 'monster' ? `<div class="el">${DB.elements[c.el].icon}</div>` : '<div class="el">🪄</div>'}
      <div class="art">${c.emoji}</div><div class="nm">${esc(c.name)}</div>${body}</div>`;
  }
  function miniHTML(m, myId) {
    const c = DB.map[m.cardId];
    const pct = Math.max(0, Math.round((m.hp / m.maxHp) * 100));
    const ab = c.abil ? `<div class="ab">${DB.abilities[c.abil].name}</div>` : '';
    return `<div class="mini el-${c.el} ${m.owner === myId ? 'mine' : ''}" title="${esc(c.name)} - ${esc(m.ownerName)}${c.abil ? ' / ' + esc(DB.abilities[c.abil].desc) : ''}">
      ${ab}<div class="art">${c.emoji}</div><div class="who">${esc(m.ownerName)}</div>
      <div class="hpl"><div style="width:${pct}%"></div></div>
      <div class="st"><span>⚔${m.atk}</span><span>❤${m.hp}</span></div></div>`;
  }
  function teamHTML(t, opts = {}) {
    const pct = t.maxHp ? Math.round((t.hp / t.maxHp) * 100) : 100;
    const hp = state.phase === 'lobby' ? '' :
      `<div class="hpbar"><div style="width:${pct}%"></div><span>🏰 ${t.hp} / ${t.maxHp}</span></div>`;
    const field = state.phase === 'lobby' ? '' :
      `<div class="field">${t.field.length ? t.field.map(m => miniHTML(m, opts.myId)).join('') : '<span class="empty">전장이 비었어요</span>'}</div>`;
    const members = t.members.map(p => {
      const cls = ['chip', state.phase === 'play' && p.ready ? 'ready' : '', p.connected ? '' : 'off'].join(' ');
      const ctrl = opts.teacher ? (state.phase === 'lobby'
        ? `<button data-act="move" data-id="${p.id}" data-team="${t.idx - 1}">◀</button><button data-act="move" data-id="${p.id}" data-team="${t.idx + 1}">▶</button><button data-act="kick" data-id="${p.id}" data-name="${esc(p.name)}">✕</button>`
        : `<button data-act="kick" data-id="${p.id}" data-name="${esc(p.name)}">✕</button>`) : '';
      return `<span class="${cls}">${state.phase === 'play' && p.ready ? '✅' : ''}${esc(p.name)}${ctrl}</span>`;
    }).join('');
    return `<div class="team ${t.alive ? '' : 'dead'} ${opts.mine ? 'mine' : ''}" style="--c:${t.color}">
      <h3>${t.icon} ${t.name}${t.alive ? '' : ' (탈락)'}<span class="cnt">${t.members.length}명</span></h3>
      ${hp}${field}<div class="members">${members}</div></div>`;
  }
  function logHTML(events) {
    return events.map((e, i) => `<div class="k-${e.k}" style="animation-delay:${Math.min(i * 0.25, 8)}s">${esc(e.text)}</div>`).join('');
  }
  function phaseLabel() {
    return { lobby: '대기실', play: `🃏 카드 내기`, battle: '⚔️ 전투 결과', end: '🏆 게임 끝' }[state.phase];
  }
  function timerHTML() { return `<span class="timer" id="timer"></span>`; }

  // ===== 홈 =====
  function renderHome() {
    role = null; state = null;
    const saved = load(LS_S) || {};
    layoutKey = 'home';
    $app.innerHTML = `<div class="home">
      <div class="logo-emoji">🐉🃏🦄</div>
      <div class="logo">몬스터 카드 배틀</div>
      <p class="muted">팀을 이뤄 몬스터를 소환하고 상대 기지를 무너뜨려라!</p>
      <div class="home-cards">
        <form class="panel" id="joinForm">
          <h2>🎒 학생 입장</h2>
          <input class="code" id="code" inputmode="numeric" maxlength="6" placeholder="학급 코드" value="${esc(saved.code || '')}" autocomplete="off">
          <input id="name" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(saved.name || '')}" autocomplete="off">
          <button class="big" type="submit">입장하기</button>
        </form>
        <div class="panel">
          <h2>🧑‍🏫 선생님</h2>
          <p class="muted">방을 만들면 학급 코드가 나와요.<br>학생들에게 코드를 알려 주세요.</p>
          <button class="big ok" data-act="create">방 만들기</button>
          <p class="muted" style="margin-top:16px">최대 20명 · 2~4팀</p>
          <button class="ghost" data-act="rules">📖 게임 규칙</button>
        </div>
      </div></div>`;
    document.getElementById('joinForm').addEventListener('submit', async e => {
      e.preventDefault();
      const code = document.getElementById('code').value.trim();
      const name = document.getElementById('name').value.trim();
      if (!/^\d{6}$/.test(code)) return toast('학급 코드 6자리를 입력해 주세요.');
      if (!name) return toast('이름을 입력해 주세요.');
      const prev = load(LS_S);
      const token = prev && prev.code === code && prev.name === name ? prev.token : undefined;
      const r = await emit('student:join', { code, name, token });
      if (r.ok) { save(LS_S, { code, name: r.name, token: r.token }); save(LS_T, null); role = 'student'; }
    });
  }

  // ===== 선생님 =====
  function renderTeacher() {
    const s = state;
    if (s.phase === 'lobby') {
      layout('t-lobby', `<div class="topbar"><b>🧑‍🏫 선생님</b><span class="pill">대기실</span><span class="grow"></span>
        <button class="ghost" data-act="rules">📖 규칙</button><button class="danger" data-act="close">방 닫기</button></div>
        <div class="wrap">
          <div class="banner"><div class="muted">학생들은 아래 주소로 접속해서 학급 코드를 입력하세요</div>
            <div style="font-size:22px;font-weight:800;margin:6px 0">${esc(location.origin)}</div>
            <div class="code-big">${s.code}</div><div id="t-count" class="muted"></div></div>
          <div class="settings" id="t-settings"></div>
          <div class="teams" id="t-teams"></div>
        </div>`);
      const st = s.settings;
      const opt = (vals, cur, fmt) => vals.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('');
      patch('t-settings', `
        <label>팀 수<select data-set="teamCount">${opt([2, 3, 4], st.teamCount, v => v + '팀')}</select></label>
        <label>카드 내기 시간<select data-set="roundTime">${opt([20, 30, 40, 60, 90, 120], st.roundTime, v => v + '초')}</select></label>
        <label>라운드 수<select data-set="maxRounds">${opt([5, 8, 10, 12, 15, 20], st.maxRounds, v => v + '라운드')}</select></label>
        <label>결과 후 자동 진행<select data-set="autoNext">${opt([0, 5, 10, 15, 20], st.autoNext, v => (v ? v + '초 뒤' : '선생님이 직접'))}</select></label>
        <button class="ghost" data-act="shuffle">🔀 팀 섞기</button>
        <button class="ok" data-act="start" style="font-size:20px;padding:12px 28px">▶ 게임 시작</button>`);
      patch('t-count', `참여 학생 ${s.playerCount} / ${s.maxPlayers}명`);
      patch('t-teams', s.teams.map(t => teamHTML(t, { teacher: true })).join(''));
      return;
    }
    if (s.phase === 'end') return renderEnd(true);
    layout('t-game', `<div class="topbar"><b>🧑‍🏫 코드 <span style="color:#facc15">${s.code}</span></b>
        <span class="pill" id="t-round"></span>${timerHTML()}<span class="grow"></span>
        <span id="t-ctrl"></span>
        <button class="ghost" data-act="rules">📖</button>
        <button class="danger" data-act="end">게임 끝내기</button></div>
      <div class="wrap grid2"><div class="teams" id="t-teams"></div>
        <div><h3 id="t-logtitle"></h3><div class="log" id="t-log"></div></div></div>`);
    const ready = s.teams.flatMap(t => (t.alive ? t.members : [])).filter(p => p.ready).length;
    const total = s.teams.flatMap(t => (t.alive ? t.members : [])).length;
    patch('t-round', `라운드 ${s.round} / ${s.settings.maxRounds} · ${phaseLabel()}`);
    patch('t-ctrl', s.phase === 'play'
      ? `<span class="pill">제출 ${ready}/${total}</span> <button class="ghost" data-act="addTime">+15초</button> <button class="warn" data-act="resolve">⚔️ 바로 전투</button>`
      : `${s.timeLeft ? '<button class="ghost" data-act="addTime">+15초</button> ' : ''}<button class="ok" data-act="next">▶ 다음 라운드</button>`);
    patch('t-teams', s.teams.map(t => teamHTML(t, { teacher: true })).join(''));
    patch('t-logtitle', s.phase === 'battle' ? `⚔️ ${s.round}라운드 전투 기록` : '📜 지난 전투 기록');
    patchLog('t-log', s.events);
  }

  function patchLog(id, events) {
    const key = state.round + ':' + events.length + ':' + (events[0] && events[0].text);
    const el = document.getElementById(id);
    if (!el) return;
    if (el._key !== key) { el.innerHTML = logHTML(events); el._key = key; el.scrollTop = 0; }
  }

  // ===== 학생 =====
  function renderStudent() {
    const s = state, you = s.you;
    if (!you) return;
    const myTeam = s.teams[you.team];
    if (s.phase === 'lobby') {
      layout('s-lobby', `<div class="topbar"><b id="s-name"></b><span class="grow"></span>
          <button class="ghost" data-act="rules">📖 규칙</button><button class="ghost" data-act="leave">나가기</button></div>
        <div class="wrap"><div class="center-msg" id="s-wait"></div><div class="teams" id="s-teams"></div></div>`);
      patch('s-name', `🎒 ${esc(you.name)}`);
      patch('s-wait', `<div class="bounce" style="font-size:60px">${myTeam.icon}</div>
        <div>나는 <b style="color:${myTeam.color}">${myTeam.name}</b>이에요!</div>
        <div class="muted">선생님이 게임을 시작할 때까지 기다려 주세요… (팀은 선생님이 바꿀 수 있어요)</div>`);
      patch('s-teams', s.teams.map(t => teamHTML(t, { mine: t.idx === you.team })).join(''));
      return;
    }
    if (s.phase === 'end') return renderEnd(false);

    layout('s-game', `<div class="topbar" id="s-top"></div>
      <div class="wrap"><div class="teams" id="s-teams"></div>
        <div id="s-log-wrap" class="hidden" style="margin-top:14px"><h3>⚔️ 전투 기록</h3><div class="log" id="s-log"></div></div></div>
      <div class="handzone"><div class="actbar" id="s-act"></div><div class="hand-row" id="s-hand"></div></div>`);

    const maxMana = Math.min(s.round + 1, 7);
    const gems = '💎'.repeat(you.mana) + '<span style="opacity:.3">' + '💎'.repeat(Math.max(0, maxMana - you.mana)) + '</span>';
    patch('s-top', `<span class="pill" style="background:${myTeam.color}">${myTeam.icon} ${esc(you.name)}</span>
      <span class="pill">라운드 ${s.round}/${s.settings.maxRounds}</span>${timerHTML()}
      <span class="pill mana" title="마나">${gems}</span><span class="grow"></span>
      <button class="ghost small" data-act="rules">📖 규칙</button>`);
    if (document.getElementById('timer')) updateTimer();

    // 내 팀을 맨 앞에
    const ordered = [myTeam, ...s.teams.filter(t => t.idx !== you.team)];
    patch('s-teams', ordered.map(t => teamHTML(t, { mine: t.idx === you.team, myId: you.id })).join(''));

    const logWrap = document.getElementById('s-log-wrap');
    logWrap.classList.toggle('hidden', s.phase !== 'battle');
    if (s.phase === 'battle') patchLog('s-log', s.events);

    // 손패 & 행동
    if (selected && !you.hand.some(h => h.uid === selected)) selected = null;
    const canPlay = s.phase === 'play' && !you.action && myTeam.alive;
    patch('s-hand', you.hand.map(h => cardHTML(h, {
      hand: canPlay, sel: canPlay && h.uid === selected, nomana: DB.map[h.cardId].cost > you.mana,
    })).join(''));

    let act;
    if (!myTeam.alive) act = `<span class="info">😢 우리 팀은 탈락했어요. 다른 팀을 응원해 주세요!</span>`;
    else if (s.phase === 'battle') act = `<span class="info">⚔️ 전투 결과를 확인하세요! 곧 다음 라운드가 시작돼요.</span>`;
    else if (you.action) {
      const playedInst = you.action.type === 'play' ? you.hand.find(h => h.uid === you.action.uid) : null;
      const what = playedInst ? `${DB.map[playedInst.cardId].emoji} ${esc(DB.map[playedInst.cardId].name)}` : '패스 (카드 +1장)';
      act = `<span class="info">✅ 제출 완료: <b>${what}</b> — 친구들을 기다리는 중…</span><button class="ghost" data-act="cancel">취소</button>`;
    } else if (selected) {
      const c = DB.map[you.hand.find(h => h.uid === selected).cardId];
      const enemies = s.teams.filter(t => t.alive && t.idx !== you.team);
      let tsel = '';
      if (c.type === 'spell' && c.target && enemies.length > 1) {
        if (!enemies.some(t => t.idx === target)) target = enemies[0].idx;
        tsel = '대상: ' + enemies.map(t => `<button class="small" style="background:${t.color};${t.idx === target ? 'outline:3px solid #fff' : 'opacity:.6'}" data-act="target" data-team="${t.idx}">${t.icon}${t.name}</button>`).join(' ');
      }
      const desc = c.type === 'spell' ? c.desc : `${DB.elements[c.el].icon}${DB.elements[c.el].name} 속성 · ⚔${c.atk} ❤${c.hp}${c.abil ? ' · ' + DB.abilities[c.abil].name + ': ' + DB.abilities[c.abil].desc : ''}`;
      act = `<span class="info"><b>${c.emoji} ${esc(c.name)}</b> — ${esc(desc)}</span> ${tsel}
        <button class="ok" data-act="play" ${c.cost > you.mana ? 'disabled' : ''}>${c.cost > you.mana ? '마나 부족' : '이 카드 내기'}</button>
        <button class="ghost" data-act="pass">패스</button>`;
    } else {
      act = `<span class="info">🃏 낼 카드를 골라 주세요 (마나 ${you.mana})</span><button class="ghost" data-act="pass">패스 (카드 +1장)</button>`;
    }
    patch('s-act', act);
  }

  // ===== 결과 =====
  function renderEnd(isTeacher) {
    const s = state;
    layout(isTeacher ? 't-end' : 's-end', `<div class="topbar"><b>🏆 게임 끝</b><span class="grow"></span><span id="end-ctrl"></span></div>
      <div class="wrap"><div class="banner" id="end-banner"></div><div class="grid2"><div class="teams" id="end-teams"></div><div id="end-mvp"></div></div></div>`);
    const winners = s.winners.map(i => s.teams[i]);
    const myWin = !isTeacher && s.you && s.winners.includes(s.you.team);
    patch('end-banner', winners.length
      ? `<div style="font-size:60px">🏆</div><div class="big">${winners.map(t => `<span style="color:${t.color}">${t.icon}${t.name}</span>`).join(' & ')} 승리!</div>
         ${isTeacher ? '' : `<div style="font-size:22px;margin-top:8px">${myWin ? '🎉 우리 팀이 이겼어요!' : '잘 싸웠어요! 다음엔 이길 수 있어요 💪'}</div>`}`
      : `<div class="big">무승부!</div>`);
    patch('end-teams', s.teams.map(t => teamHTML(t, { mine: s.you && t.idx === s.you.team, myId: s.you && s.you.id })).join(''));
    const all = s.teams.flatMap(t => t.members.map(m => ({ ...m, team: t })));
    all.sort((a, b) => (b.stats ? b.stats.damage : 0) - (a.stats ? a.stats.damage : 0));
    const medal = ['🥇', '🥈', '🥉'];
    patch('end-mvp', `<h3>⭐ 활약 순위</h3><table class="rank"><tr><th></th><th>이름</th><th>피해량</th><th>처치</th><th>카드</th></tr>
      ${all.slice(0, 10).map((p, i) => `<tr ${s.you && p.id === s.you.id ? 'style="background:#facc1533"' : ''}><td>${medal[i] || i + 1}</td>
        <td style="color:${p.team.color}">${esc(p.name)}</td><td>${p.stats ? p.stats.damage : 0}</td><td>${p.stats ? p.stats.kills : 0}</td><td>${p.stats ? p.stats.played : 0}</td></tr>`).join('')}</table>`);
    patch('end-ctrl', isTeacher
      ? `<button class="ok" data-act="lobby">🔁 다시 하기 (대기실로)</button> <button class="danger" data-act="close">방 닫기</button>`
      : `<button class="ghost" data-act="leave">나가기</button>`);
  }

  function render() {
    if (!DB) return;
    if (!state || !role) return;
    if (role === 'teacher') renderTeacher(); else renderStudent();
    updateTimer();
  }

  function updateTimer() {
    const el = document.getElementById('timer');
    if (!el) return;
    if (!deadlineAt) { el.textContent = ''; return; }
    const sec = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    el.textContent = '⏱ ' + sec;
    el.classList.toggle('low', state && state.phase === 'play' && sec <= 5);
  }
  setInterval(updateTimer, 250);

  // ===== 이벤트 =====
  document.addEventListener('change', e => {
    const k = e.target.dataset.set;
    if (k) emit('teacher:settings', { [k]: +e.target.value });
  });

  document.addEventListener('click', async e => {
    if (e.target.matches('[data-close]') || e.target.id === 'rules') return document.getElementById('rules').classList.add('hidden');
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    switch (act) {
      case 'rules': document.getElementById('rules').classList.remove('hidden'); break;
      case 'create': {
        const r = await emit('teacher:create', {});
        if (r.ok) { save(LS_T, { code: r.code, teacherKey: r.teacherKey }); save(LS_S, null); role = 'teacher'; }
        break;
      }
      case 'shuffle': emit('teacher:shuffle'); break;
      case 'start': emit('teacher:start'); break;
      case 'move': emit('teacher:move', { playerId: el.dataset.id, team: +el.dataset.team }); break;
      case 'kick': if (confirm(`${el.dataset.name} 학생을 내보낼까요?`)) emit('teacher:kick', { playerId: el.dataset.id }); break;
      case 'resolve': emit('teacher:resolve'); break;
      case 'next': emit('teacher:next'); break;
      case 'addTime': emit('teacher:addTime'); break;
      case 'end': if (confirm('게임을 끝내고 결과를 볼까요?')) emit('teacher:end'); break;
      case 'lobby': emit('teacher:lobby'); break;
      case 'close':
        if (confirm('방을 닫을까요? 모든 학생이 나가게 돼요.')) { await emit('teacher:close'); save(LS_T, null); renderHome(); }
        break;
      case 'select': selected = selected === el.dataset.uid ? null : el.dataset.uid; render(); break;
      case 'target': target = +el.dataset.team; render(); break;
      case 'play': {
        const r = await emit('student:act', { type: 'play', uid: selected, target });
        if (r.ok) selected = null;
        break;
      }
      case 'pass': emit('student:act', { type: 'pass' }); selected = null; break;
      case 'cancel': emit('student:cancel'); break;
      case 'leave':
        if (confirm('게임에서 나갈까요?')) { socket.emit('student:leave'); const s = load(LS_S); if (s) save(LS_S, { code: s.code, name: s.name }); renderHome(); }
        break;
    }
  });

  // ===== 소켓 =====
  socket.on('connect', async () => {
    const t = load(LS_T), s = load(LS_S);
    if (t) {
      const r = await new Promise(res => socket.emit('teacher:resume', t, res));
      if (r && r.ok) { role = 'teacher'; return; }
      save(LS_T, null);
    }
    if (s && s.token) {
      const r = await new Promise(res => socket.emit('student:join', s, res));
      if (r && r.ok) { role = 'student'; return; }
      save(LS_S, { code: s.code, name: s.name });
    }
    if (!role && layoutKey !== 'home') renderHome();
  });
  socket.on('disconnect', () => toast('연결이 끊겼어요. 다시 연결하는 중…'));
  socket.on('state', s => {
    state = s;
    deadlineAt = s.timeLeft ? Date.now() + s.timeLeft : 0;
    render();
  });
  socket.on('kicked', () => { save(LS_S, null); toast('선생님이 방에서 내보냈어요.'); renderHome(); });
  socket.on('closed', () => {
    if (role === 'student') { const s = load(LS_S); if (s) save(LS_S, { code: '', name: s.name }); toast('선생님이 방을 닫았어요.'); renderHome(); }
  });

  fetch('/api/cards').then(r => r.json()).then(d => {
    d.map = Object.fromEntries(d.cards.map(c => [c.id, c]));
    DB = d;
    document.getElementById('abil-list').innerHTML = Object.values(d.abilities).map(a => `<li><b>${a.name}</b> : ${a.desc}</li>`).join('');
    if (!role) { if (layoutKey !== 'home') renderHome(); } else render();
  });
})();
