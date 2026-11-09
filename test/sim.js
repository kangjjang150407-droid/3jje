// 게임 로직 시뮬레이션 테스트: 무작위 플레이로 여러 판을 돌려 오류가 없는지 확인
'use strict';
const assert = require('assert');
const { Room, CARD_MAP } = require('../game');

function playGame(teamCount, players) {
  const room = new Room('123456', { teamCount, maxRounds: 10 });
  for (let i = 0; i < players; i++) assert(room.addPlayer('학생' + i).player);
  assert(room.addPlayer('학생0').error, '중복 이름은 거부');
  assert.strictEqual(room.start(), null);
  let guard = 0;
  while (room.phase !== 'end' && guard++ < 100) {
    assert.strictEqual(room.phase, 'play');
    for (const p of room.players.values()) {
      const playable = p.hand.filter(h => CARD_MAP[h.cardId].cost <= p.mana);
      const choice = playable.length && Math.random() < 0.9 ? playable[Math.floor(Math.random() * playable.length)] : null;
      const err = room.submit(p.id, choice ? { type: 'play', uid: choice.uid, target: Math.floor(Math.random() * teamCount) } : { type: 'pass' });
      if (room.teams[p.team].alive) assert.strictEqual(err, null, err);
    }
    room.resolve();
    for (const t of room.teams) {
      assert(t.hp >= 0 && t.hp <= t.maxHp, 'hp range');
      assert(t.field.every(m => m.hp > 0), 'no dead monsters on field');
      const owners = t.field.map(m => m.owner);
      assert.strictEqual(new Set(owners).size, owners.length, 'one monster per player');
    }
    for (const p of room.players.values()) assert(p.hand.length <= 7);
    JSON.stringify(room.publicState(true));
    if (room.phase === 'battle') room.nextRound();
  }
  assert.strictEqual(room.phase, 'end');
  return room;
}

const rooms = [];
for (let i = 0; i < 300; i++) rooms.push(playGame(2 + (i % 3), Math.max(2 + (i % 3), 2 + (i % 19))));
const avg = rooms.reduce((a, r) => a + r.round, 0) / rooms.length;
const ko = rooms.filter(r => r.teams.filter(t => t.alive).length <= 1).length;
console.log(`300판 완료 · 평균 ${avg.toFixed(1)}라운드 · 기지 파괴로 끝난 판 ${ko}`);

// 최대 인원 제한
const r = new Room('111111');
for (let i = 0; i < 20; i++) r.addPlayer('p' + i);
assert(r.addPlayer('p20').error, '21번째는 거부');
console.log('✅ 모든 테스트 통과');
