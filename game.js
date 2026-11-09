'use strict';
// 몬스터 카드 배틀 - 게임 로직 (서버 전용, 순수 로직)

const ELEMENTS = {
  fire: { name: '불', icon: '🔥' },
  water: { name: '물', icon: '💧' },
  grass: { name: '풀', icon: '🌿' },
  light: { name: '빛', icon: '✨' },
  dark: { name: '어둠', icon: '🌙' },
};
// 공격 속성이 상대 속성을 이기면 피해 1.5배
const BEATS = { fire: 'grass', grass: 'water', water: 'fire', light: 'dark', dark: 'light' };

const ABILITIES = {
  taunt: { name: '도발', desc: '적은 이 몬스터를 먼저 공격해야 해요' },
  drain: { name: '흡혈', desc: '준 피해만큼 체력을 회복해요' },
  siege: { name: '돌격', desc: '몬스터를 무시하고 적 기지를 바로 공격해요 (반격 없음)' },
  splash: { name: '광역', desc: '적 팀 몬스터 전체에게 공격력의 절반 피해 (반격 없음)' },
  healer: { name: '치유', desc: '전투가 끝나면 아군 몬스터 모두 체력 회복' },
  shield: { name: '단단함', desc: '받는 피해가 1 줄어들어요' },
};

const M = (id, name, emoji, el, cost, atk, hp, abil = null, heal = 0) =>
  ({ id, type: 'monster', name, emoji, el, cost, atk, hp, abil, heal });
const S = (id, name, emoji, cost, kind, desc, target = false) =>
  ({ id, type: 'spell', name, emoji, cost, kind, desc, target });

const CARDS = [
  // 1코스트
  M('m01', '불씨도롱뇽', '🦎', 'fire', 1, 2, 2),
  M('m02', '방울게', '🦀', 'water', 1, 1, 4, 'shield'),
  M('m03', '새싹토끼', '🐰', 'grass', 1, 2, 3),
  M('m04', '반짝벌', '🐝', 'light', 1, 1, 3, 'healer', 1),
  M('m05', '그림자쥐', '🐭', 'dark', 1, 3, 1),
  // 2코스트
  M('m06', '화염여우', '🦊', 'fire', 2, 2, 3, 'siege'),
  M('m07', '방패거북', '🐢', 'water', 2, 1, 6, 'taunt'),
  M('m08', '덩굴뱀', '🐍', 'grass', 2, 3, 4),
  M('m09', '별빛부엉이', '🦉', 'light', 2, 2, 4, 'healer', 1),
  M('m10', '흡혈박쥐', '🦇', 'dark', 2, 2, 4, 'drain'),
  // 3코스트
  M('m11', '용암골렘', '🗿', 'fire', 3, 4, 6, 'shield'),
  M('m12', '상어기사', '🦈', 'water', 3, 5, 4),
  M('m13', '숲의 곰', '🐻', 'grass', 3, 3, 8, 'taunt'),
  M('m14', '무지개유니콘', '🦄', 'light', 3, 4, 5, 'healer', 2),
  M('m15', '달늑대', '🐺', 'dark', 3, 4, 5, 'drain'),
  // 4코스트
  M('m16', '불꽃독수리', '🦅', 'fire', 4, 5, 5, 'siege'),
  M('m17', '심해문어', '🐙', 'water', 4, 4, 9, 'splash'),
  M('m18', '고목정령', '🌳', 'grass', 4, 3, 12, 'taunt'),
  M('m19', '수호천사', '👼', 'light', 4, 5, 7, 'healer', 2),
  M('m20', '그림자용', '🐉', 'dark', 4, 7, 6),
  // 5코스트
  M('m21', '태양사자', '🦁', 'light', 5, 7, 9, 'splash'),
  M('m22', '거대고래', '🐋', 'water', 5, 5, 14, 'taunt'),
  M('m23', '화산드래곤', '🐲', 'fire', 5, 8, 8, 'splash'),
  M('m24', '밀림고릴라', '🦍', 'grass', 5, 8, 10),
  M('m25', '밤의 마왕', '👹', 'dark', 5, 9, 8, 'drain'),
  // 마법
  S('s01', '회복 물약', '🧪', 1, 'healmon', '내 몬스터 체력 5 회복 (몬스터가 없으면 기지 3 회복)'),
  S('s02', '성벽 수리', '🏰', 2, 'healbase', '우리 팀 기지 체력 6 회복'),
  S('s03', '힘의 룬', '💪', 2, 'buff', '내 몬스터 공격력 +2, 체력 +2 (없으면 아군 몬스터 하나)'),
  S('s04', '파이어볼', '☄️', 2, 'fireball', '적의 가장 강한 몬스터에게 4 피해 (없으면 기지에 4 피해)', true),
  S('s05', '번개폭풍', '⚡', 3, 'storm', '적 팀 몬스터 모두에게 2 피해', true),
  S('s06', '치유의 비', '🌧️', 3, 'rain', '우리 팀 몬스터 모두 체력 3 회복'),
  S('s07', '운석 낙하', '🌠', 4, 'meteor', '적 기지에 7 피해', true),
];
const CARD_MAP = Object.fromEntries(CARDS.map(c => [c.id, c]));
const COST_WEIGHT = { 1: 5, 2: 5, 3: 4, 4: 3, 5: 2 };

const TEAM_PRESETS = [
  { name: '불꽃팀', color: '#ef4444', icon: '🔥' },
  { name: '파도팀', color: '#3b82f6', icon: '🌊' },
  { name: '새싹팀', color: '#22c55e', icon: '🌱' },
  { name: '번개팀', color: '#eab308', icon: '⚡' },
];

const HAND_START = 5;
const HAND_MAX = 7;
const MAX_MANA = 7;
const MAX_PLAYERS = 20;

let uidCounter = 1;
const uid = () => (uidCounter++).toString(36);
const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function drawCard(maxCost = 5) {
  const pool = [];
  for (const c of CARDS) {
    if (c.cost > maxCost) continue;
    const w = c.type === 'spell' ? 2 : COST_WEIGHT[c.cost];
    for (let i = 0; i < w; i++) pool.push(c.id);
  }
  return { uid: uid(), cardId: pick(pool) };
}

function startingHand() {
  // 싼 몬스터 2장 보장
  const cheap = CARDS.filter(c => c.type === 'monster' && c.cost <= 2);
  const hand = [0, 1].map(() => ({ uid: uid(), cardId: pick(cheap).id }));
  while (hand.length < HAND_START) hand.push(drawCard());
  return hand;
}

const elMult = (a, d) => (BEATS[a] === d ? 1.5 : 1);

class Room {
  constructor(code, settings = {}) {
    this.code = code;
    this.teacherKey = uid() + Math.random().toString(36).slice(2);
    this.settings = { teamCount: 2, roundTime: 40, maxRounds: 10, autoNext: 10 };
    this.updateSettings(settings);
    this.phase = 'lobby'; // lobby | play | battle | end
    this.players = new Map();
    this.teams = [];
    this.round = 0;
    this.events = [];
    this.deadline = 0;
    this.winners = [];
    this.lastActive = Date.now();
  }

  updateSettings(s) {
    const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
    const cur = this.settings;
    this.settings = {
      teamCount: clamp(s.teamCount ?? cur.teamCount, 2, 4, 2),
      roundTime: clamp(s.roundTime ?? cur.roundTime, 15, 180, 40),
      maxRounds: clamp(s.maxRounds ?? cur.maxRounds, 3, 30, 10),
      autoNext: clamp(s.autoNext ?? cur.autoNext, 0, 60, 10),
    };
    if (this.phase === 'lobby') {
      for (const p of this.players.values()) if (p.team >= this.settings.teamCount) p.team = this.smallestTeam();
    }
  }

  teamSizes() {
    const sizes = Array(this.settings.teamCount).fill(0);
    for (const p of this.players.values()) if (p.team < sizes.length) sizes[p.team]++;
    return sizes;
  }

  smallestTeam(onlyAlive = false) {
    const sizes = this.teamSizes();
    let best = -1;
    sizes.forEach((s, i) => {
      if (onlyAlive && this.teams[i] && !this.teams[i].alive) return;
      if (best < 0 || s < sizes[best]) best = i;
    });
    return Math.max(best, 0);
  }

  addPlayer(name) {
    if (this.players.size >= MAX_PLAYERS) return { error: `최대 ${MAX_PLAYERS}명까지 참여할 수 있어요.` };
    for (const p of this.players.values()) if (p.name === name) return { error: '이미 같은 이름이 있어요. 다른 이름을 써 주세요.' };
    const p = {
      id: uid() + Math.random().toString(36).slice(2, 8),
      name, team: this.smallestTeam(this.phase !== 'lobby'),
      hand: [], mana: 0, action: null, connected: true,
      stats: { damage: 0, kills: 0, played: 0 },
    };
    if (this.phase !== 'lobby' && this.phase !== 'end') {
      p.hand = startingHand();
      p.mana = this.maxMana();
    }
    this.players.set(p.id, p);
    return { player: p };
  }

  shuffleTeams() {
    const list = shuffle([...this.players.values()]);
    list.forEach((p, i) => { p.team = i % this.settings.teamCount; });
  }

  maxMana() { return Math.min(this.round + 1, MAX_MANA); }

  start() {
    if (this.players.size < 2) return '학생이 2명 이상 있어야 시작할 수 있어요.';
    const sizes = this.teamSizes();
    if (sizes.some(s => s === 0)) return '모든 팀에 학생이 1명 이상 있어야 해요.';
    this.teams = sizes.map((size, i) => ({
      ...TEAM_PRESETS[i], idx: i, alive: true,
      hp: 20 + size * 3, maxHp: 20 + size * 3, field: [],
    }));
    for (const p of this.players.values()) {
      p.hand = startingHand();
      p.action = null;
      p.stats = { damage: 0, kills: 0, played: 0 };
    }
    this.round = 0;
    this.winners = [];
    this.events = [{ k: 'info', text: '⚔️ 게임 시작! 카드를 골라 내세요.' }];
    this.nextRound();
    return null;
  }

  nextRound() {
    this.round++;
    this.phase = 'play';
    for (const p of this.players.values()) { p.mana = this.maxMana(); p.action = null; }
    this.deadline = Date.now() + this.settings.roundTime * 1000;
  }

  activePlayers() {
    return [...this.players.values()].filter(p => this.teams[p.team] && this.teams[p.team].alive);
  }

  allSubmitted() {
    const act = this.activePlayers().filter(p => p.connected);
    return act.length > 0 && act.every(p => p.action);
  }

  submit(playerId, action) {
    if (this.phase !== 'play') return '지금은 카드를 낼 수 없어요.';
    const p = this.players.get(playerId);
    if (!p) return '플레이어를 찾을 수 없어요.';
    if (!this.teams[p.team] || !this.teams[p.team].alive) return '우리 팀은 탈락했어요. 응원해 주세요!';
    if (!action || action.type === 'pass') { p.action = { type: 'pass' }; return null; }
    const inst = p.hand.find(h => h.uid === action.uid);
    if (!inst) return '손에 없는 카드예요.';
    const card = CARD_MAP[inst.cardId];
    if (card.cost > p.mana) return '마나가 부족해요.';
    let target = null;
    if (card.type === 'spell' && card.target) {
      const enemies = this.teams.filter(t => t.alive && t.idx !== p.team).map(t => t.idx);
      target = enemies.includes(+action.target) ? +action.target : null;
    }
    p.action = { type: 'play', uid: inst.uid, target };
    return null;
  }

  // ===== 전투 처리 =====
  resolve() {
    if (this.phase !== 'play') return;
    const ev = [];
    const T = i => this.teams[i];
    const tn = t => `${t.icon}${t.name}`;
    const owner = m => this.players.get(m.owner);
    const ownerName = m => (owner(m) ? owner(m).name : '?');
    const enemyTeams = idx => this.teams.filter(t => t.alive && t.idx !== idx);
    const credit = (pid, dmg) => { const pl = this.players.get(pid); if (pl) pl.stats.damage += dmg; };

    const hitBase = (team, dmg, by) => {
      if (!team.alive || dmg <= 0) return;
      team.hp = Math.max(0, team.hp - dmg);
      credit(by, dmg);
      if (team.hp === 0) {
        team.alive = false;
        team.field = [];
        ev.push({ k: 'elim', text: `💥 ${tn(team)} 기지가 무너졌어요! 탈락!` });
      }
    };
    const hitMon = (mon, dmg, by) => {
      if (mon.abil === 'shield') dmg = Math.max(0, dmg - 1);
      const dealt = Math.min(dmg, Math.max(mon.hp, 0));
      mon.hp -= dmg;
      credit(by, dealt);
      if (mon.hp <= 0 && !mon.dead) {
        mon.dead = true;
        const pl = this.players.get(by); if (pl) pl.stats.kills++;
      }
      return dealt;
    };
    const cleanup = () => {
      for (const t of this.teams) {
        const dead = t.field.filter(m => m.hp <= 0);
        dead.forEach(m => ev.push({ k: 'die', text: `☠️ ${m.emoji}${m.name}(${ownerName(m)}) 쓰러짐` }));
        t.field = t.field.filter(m => m.hp > 0);
      }
    };
    const resolveTarget = (p, chosen) => {
      const enemies = enemyTeams(p.team);
      if (!enemies.length) return null;
      return enemies.find(t => t.idx === chosen) || pick(enemies);
    };

    // 1) 카드 사용 처리
    const actors = shuffle(this.activePlayers().filter(p => p.action));
    const spells = [];
    for (const p of actors) {
      if (p.action.type === 'pass') {
        if (p.hand.length < HAND_MAX) p.hand.push(drawCard());
        continue;
      }
      const i = p.hand.findIndex(h => h.uid === p.action.uid);
      if (i < 0) continue;
      const card = CARD_MAP[p.hand[i].cardId];
      p.hand.splice(i, 1);
      p.stats.played++;
      if (card.type === 'monster') {
        const team = T(p.team);
        const old = team.field.findIndex(m => m.owner === p.id);
        if (old >= 0) team.field.splice(old, 1);
        team.field.push({
          uid: uid(), cardId: card.id, owner: p.id, ownerName: p.name, name: card.name, emoji: card.emoji,
          el: card.el, atk: card.atk, hp: card.hp, maxHp: card.hp, abil: card.abil, heal: card.heal,
        });
        ev.push({ k: 'summon', team: p.team, text: `${tn(team)} ${p.name}: ${card.emoji}${card.name} 소환! (${card.atk}/${card.hp})` });
      } else {
        spells.push({ p, card, target: p.action.target });
      }
    }
    // 2) 지원 마법 → 공격 마법 순서
    const support = ['healmon', 'healbase', 'buff', 'rain'];
    spells.sort((a, b) => support.includes(b.card.kind) - support.includes(a.card.kind));
    for (const { p, card, target } of spells) {
      const team = T(p.team);
      if (!team.alive) continue;
      const mine = team.field.find(m => m.owner === p.id);
      const who = `${tn(team)} ${p.name}: ${card.emoji}${card.name}`;
      switch (card.kind) {
        case 'healmon':
          if (mine) { mine.hp = Math.min(mine.maxHp, mine.hp + 5); ev.push({ k: 'heal', text: `${who} → ${mine.emoji}${mine.name} 체력 회복` }); }
          else { team.hp = Math.min(team.maxHp, team.hp + 3); ev.push({ k: 'heal', text: `${who} → 기지 체력 +3` }); }
          break;
        case 'healbase':
          team.hp = Math.min(team.maxHp, team.hp + 6); ev.push({ k: 'heal', text: `${who} → 기지 체력 +6` });
          break;
        case 'buff': {
          const m = mine || pick(team.field.length ? team.field : [null]);
          if (m) { m.atk += 2; m.hp += 2; m.maxHp += 2; ev.push({ k: 'heal', text: `${who} → ${m.emoji}${m.name} 강화! (${m.atk}/${m.hp})` }); }
          else ev.push({ k: 'info', text: `${who} → 강화할 몬스터가 없어요` });
          break;
        }
        case 'rain':
          team.field.forEach(m => { m.hp = Math.min(m.maxHp, m.hp + 3); });
          ev.push({ k: 'heal', text: `${who} → 아군 몬스터 모두 회복` });
          break;
        case 'fireball': {
          const et = resolveTarget(p, target); if (!et) break;
          const living = et.field.filter(m => m.hp > 0);
          if (living.length) {
            const m = living.reduce((a, b) => (b.atk > a.atk ? b : a));
            ev.push({ k: 'attack', text: `${who} → ${tn(et)} ${m.emoji}${m.name}에게 4 피해` }); hitMon(m, 4, p.id);
          } else { ev.push({ k: 'base', text: `${who} → ${tn(et)} 기지에 4 피해` }); hitBase(et, 4, p.id); }
          break;
        }
        case 'storm': {
          const et = resolveTarget(p, target); if (!et) break;
          et.field.forEach(m => hitMon(m, 2, p.id));
          ev.push({ k: 'attack', text: `${who} → ${tn(et)} 몬스터 모두에게 2 피해` });
          break;
        }
        case 'meteor': {
          const et = resolveTarget(p, target); if (!et) break;
          ev.push({ k: 'base', text: `${who} → ${tn(et)} 기지에 7 피해!` });
          hitBase(et, 7, p.id);
          break;
        }
      }
    }
    cleanup();

    // 3) 몬스터 전투
    const attackers = shuffle(this.teams.flatMap(t => t.field.map(m => ({ m, t }))));
    for (const { m, t } of attackers) {
      if (m.hp <= 0 || !t.alive) continue;
      const enemies = enemyTeams(t.idx);
      if (!enemies.length) break;
      const et = pick(enemies);
      const living = et.field.filter(x => x.hp > 0);
      const me = `${m.emoji}${m.name}`;
      if (m.abil === 'siege' || !living.length) {
        ev.push({ k: 'base', team: t.idx, text: `${me}(${tn(t)}) → ${tn(et)} 기지에 ${m.atk} 피해` });
        hitBase(et, m.atk, m.owner);
      } else if (m.abil === 'splash') {
        living.forEach(x => hitMon(x, Math.ceil((m.atk * elMult(m.el, x.el)) / 2), m.owner));
        ev.push({ k: 'attack', team: t.idx, text: `${me}(${tn(t)}) 광역 공격! → ${tn(et)} 몬스터 전체` });
      } else {
        const taunts = living.filter(x => x.abil === 'taunt');
        const tgt = pick(taunts.length ? taunts : living);
        const dmg = Math.round(m.atk * elMult(m.el, tgt.el));
        const counter = Math.round(tgt.atk * elMult(tgt.el, m.el));
        const before = tgt.hp;
        const dealt = hitMon(tgt, dmg, m.owner);
        hitMon(m, counter, tgt.owner);
        if (m.abil === 'drain' && m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + dealt);
        const strong = elMult(m.el, tgt.el) > 1 ? ' (속성 유리!)' : '';
        ev.push({ k: 'attack', team: t.idx, text: `${me}(${tn(t)}) ⚔ ${tgt.emoji}${tgt.name}(${tn(et)}) : ${dmg} 피해${strong}` });
        // 관통: 몬스터를 쓰러뜨리고 남은 피해는 기지로
        const over = tgt.hp <= 0 ? Math.max(0, dmg - Math.max(before, 0) - (tgt.abil === 'shield' ? 1 : 0)) : 0;
        if (over > 0) { ev.push({ k: 'base', team: t.idx, text: `  ↳ 관통! ${tn(et)} 기지에 ${over} 피해` }); hitBase(et, over, m.owner); }
      }
    }
    cleanup();

    // 4) 치유 능력
    for (const t of this.teams) {
      for (const h of t.field.filter(x => x.abil === 'healer')) {
        t.field.forEach(x => { x.hp = Math.min(x.maxHp, x.hp + h.heal); });
      }
    }

    // 5) 카드 보충
    for (const p of this.players.values()) {
      if (p.hand.length < HAND_MAX) p.hand.push(drawCard(Math.min(5, this.maxMana() + 1)));
    }

    this.events = ev.length ? ev : [{ k: 'info', text: '이번 라운드에는 아무 일도 없었어요.' }];
    const alive = this.teams.filter(t => t.alive);
    if (alive.length <= 1 || this.round >= this.settings.maxRounds) this.finish();
    else { this.phase = 'battle'; this.deadline = this.settings.autoNext ? Date.now() + this.settings.autoNext * 1000 : 0; }
  }

  finish() {
    this.phase = 'end';
    this.deadline = 0;
    const alive = this.teams.filter(t => t.alive);
    if (alive.length === 0) { this.winners = []; return; }
    const best = Math.max(...alive.map(t => t.hp));
    this.winners = alive.filter(t => t.hp === best).map(t => t.idx);
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.teams = [];
    this.round = 0;
    this.events = [];
    this.winners = [];
    this.deadline = 0;
    for (const p of this.players.values()) { p.hand = []; p.action = null; }
  }

  // ===== 클라이언트로 보내는 상태 =====
  publicState(forTeacher) {
    const sizes = this.teamSizes();
    const teamsInfo = (this.teams.length ? this.teams : sizes.map((_, i) => ({ ...TEAM_PRESETS[i], idx: i, alive: true, field: [] })))
      .map(t => ({
        idx: t.idx, name: t.name, color: t.color, icon: t.icon, alive: t.alive, hp: t.hp, maxHp: t.maxHp,
        field: t.field.map(m => ({ uid: m.uid, cardId: m.cardId, owner: m.owner, ownerName: m.ownerName, atk: m.atk, hp: m.hp, maxHp: m.maxHp })),
        members: [...this.players.values()].filter(p => p.team === t.idx).map(p => ({
          id: p.id, name: p.name, connected: p.connected, ready: !!p.action, ...(this.phase === 'end' ? { stats: p.stats } : {}),
        })),
      }));
    return {
      code: this.code, phase: this.phase, round: this.round, settings: this.settings,
      timeLeft: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
      teams: teamsInfo, events: this.events, winners: this.winners, playerCount: this.players.size,
      maxPlayers: MAX_PLAYERS, isTeacher: !!forTeacher,
    };
  }

  playerState(pid) {
    const p = this.players.get(pid);
    const s = this.publicState(false);
    if (p) s.you = { id: p.id, name: p.name, team: p.team, hand: p.hand, mana: p.mana, action: p.action, stats: p.stats };
    return s;
  }
}

module.exports = { Room, CARDS, CARD_MAP, ELEMENTS, BEATS, ABILITIES, MAX_PLAYERS };
