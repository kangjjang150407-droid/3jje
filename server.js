'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room, CARDS, ELEMENTS, BEATS, ABILITIES } = require('./game');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/cards', (_req, res) => res.json({ cards: CARDS, elements: ELEMENTS, beats: BEATS, abilities: ABILITIES }));

const rooms = new Map(); // code -> Room
const timers = new Map(); // code -> timeout

function newCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
}

function broadcast(room) {
  room.lastActive = Date.now();
  const sockets = io.sockets.adapter.rooms.get('room:' + room.code);
  if (!sockets) return;
  for (const sid of sockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    if (s.data.teacher) s.emit('state', room.publicState(true));
    else if (s.data.playerId) s.emit('state', room.playerState(s.data.playerId));
  }
}

function schedule(room) {
  clearTimeout(timers.get(room.code));
  timers.delete(room.code);
  if (!room.deadline) return;
  const ms = Math.max(0, room.deadline - Date.now());
  timers.set(room.code, setTimeout(() => {
    if (room.phase === 'play') room.resolve();
    else if (room.phase === 'battle') room.nextRound();
    else return;
    schedule(room);
    broadcast(room);
  }, ms));
}

function checkAllSubmitted(room) {
  if (room.phase === 'play' && room.allSubmitted()) {
    // 모두 제출하면 1.5초 뒤 전투 (마지막 학생이 취소할 여유)
    room.deadline = Math.min(room.deadline, Date.now() + 1500);
    schedule(room);
  }
}

io.on('connection', socket => {
  const teacherRoom = () => {
    const room = rooms.get(socket.data.code);
    return room && socket.data.teacher ? room : null;
  };
  const teacherAction = (fn) => (data, cb = () => {}) => {
    const room = teacherRoom();
    if (!room) return cb({ error: '방을 찾을 수 없어요.' });
    const err = fn(room, data || {});
    if (err) return cb({ error: err });
    schedule(room);
    broadcast(room);
    cb({ ok: true });
  };

  // ----- 선생님 -----
  socket.on('teacher:create', (settings, cb = () => {}) => {
    const code = newCode();
    const room = new Room(code, settings || {});
    rooms.set(code, room);
    socket.data = { code, teacher: true };
    socket.join('room:' + code);
    cb({ ok: true, code, teacherKey: room.teacherKey });
    broadcast(room);
  });

  socket.on('teacher:resume', ({ code, teacherKey } = {}, cb = () => {}) => {
    const room = rooms.get(String(code));
    if (!room || room.teacherKey !== teacherKey) return cb({ error: '방이 없어졌어요.' });
    socket.data = { code: room.code, teacher: true };
    socket.join('room:' + room.code);
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('teacher:settings', teacherAction((room, s) => {
    if (room.phase !== 'lobby') return '게임 중에는 설정을 바꿀 수 없어요.';
    room.updateSettings(s);
  }));
  socket.on('teacher:move', teacherAction((room, { playerId, team }) => {
    const p = room.players.get(playerId);
    if (!p) return '학생을 찾을 수 없어요.';
    if (room.phase !== 'lobby') return '팀 이동은 대기실에서만 할 수 있어요.';
    p.team = ((+team % room.settings.teamCount) + room.settings.teamCount) % room.settings.teamCount;
  }));
  socket.on('teacher:shuffle', teacherAction(room => {
    if (room.phase !== 'lobby') return '대기실에서만 할 수 있어요.';
    room.shuffleTeams();
  }));
  socket.on('teacher:kick', teacherAction((room, { playerId }) => {
    const p = room.players.get(playerId);
    if (!p) return '학생을 찾을 수 없어요.';
    room.players.delete(playerId);
    for (const t of room.teams) t.field = t.field.filter(m => m.owner !== playerId);
    for (const [, s] of io.sockets.sockets) {
      if (s.data.playerId === playerId) { s.emit('kicked'); s.leave('room:' + room.code); s.data = {}; }
    }
    checkAllSubmitted(room);
  }));
  socket.on('teacher:start', teacherAction(room => {
    if (room.phase !== 'lobby') return '이미 게임 중이에요.';
    return room.start();
  }));
  socket.on('teacher:resolve', teacherAction(room => {
    if (room.phase !== 'play') return '카드 내기 시간이 아니에요.';
    room.resolve();
  }));
  socket.on('teacher:next', teacherAction(room => {
    if (room.phase !== 'battle') return '전투 결과 화면이 아니에요.';
    room.nextRound();
  }));
  socket.on('teacher:addTime', teacherAction(room => {
    if (room.phase !== 'play' && room.phase !== 'battle') return '지금은 시간을 늘릴 수 없어요.';
    if (!room.deadline) return '자동 진행이 꺼져 있어요.';
    room.deadline += 15000;
  }));
  socket.on('teacher:end', teacherAction(room => {
    if (room.phase === 'lobby') return '게임이 시작되지 않았어요.';
    room.finish();
  }));
  socket.on('teacher:lobby', teacherAction(room => { room.resetToLobby(); }));
  socket.on('teacher:close', (_d, cb = () => {}) => {
    const room = teacherRoom();
    if (!room) return cb({ error: '방을 찾을 수 없어요.' });
    io.to('room:' + room.code).emit('closed');
    clearTimeout(timers.get(room.code));
    rooms.delete(room.code);
    cb({ ok: true });
  });

  // ----- 학생 -----
  socket.on('student:join', ({ code, name, token } = {}, cb = () => {}) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return cb({ error: '학급 코드를 다시 확인해 주세요.' });
    let p = token && room.players.get(token);
    if (!p) {
      name = String(name || '').trim().slice(0, 10);
      if (!name) return cb({ error: '이름을 입력해 주세요.' });
      const r = room.addPlayer(name);
      if (r.error) return cb({ error: r.error });
      p = r.player;
    }
    p.connected = true;
    socket.data = { code: room.code, playerId: p.id };
    socket.join('room:' + room.code);
    cb({ ok: true, token: p.id, code: room.code, name: p.name });
    broadcast(room);
  });

  socket.on('student:act', (action, cb = () => {}) => {
    const room = rooms.get(socket.data.code);
    if (!room || !socket.data.playerId) return cb({ error: '방에 참여하지 않았어요.' });
    const err = room.submit(socket.data.playerId, action);
    if (err) return cb({ error: err });
    cb({ ok: true });
    checkAllSubmitted(room);
    broadcast(room);
  });

  socket.on('student:cancel', (_d, cb = () => {}) => {
    const room = rooms.get(socket.data.code);
    const p = room && room.players.get(socket.data.playerId);
    if (!p || room.phase !== 'play') return cb({ error: '취소할 수 없어요.' });
    p.action = null;
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('student:leave', () => {
    const room = rooms.get(socket.data.code);
    if (room && socket.data.playerId && room.phase === 'lobby') room.players.delete(socket.data.playerId);
    socket.leave('room:' + socket.data.code);
    socket.data = {};
    if (room) broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room || !socket.data.playerId) return;
    const p = room.players.get(socket.data.playerId);
    if (p) {
      const stillOn = [...io.sockets.sockets.values()].some(s => s.id !== socket.id && s.data.playerId === p.id);
      if (!stillOn) p.connected = false;
    }
    checkAllSubmitted(room);
    broadcast(room);
  });
});

// 3시간 동안 활동 없는 방 정리
setInterval(() => {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.lastActive < cutoff) { clearTimeout(timers.get(code)); timers.delete(code); rooms.delete(code); }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`몬스터 카드 배틀 서버 실행 중: http://localhost:${PORT}`);
});
