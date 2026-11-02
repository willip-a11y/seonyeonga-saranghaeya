/**
 * 선영아 사랑해야 — dependency-free real-time community prototype.
 * Node.js 20+ / single process / no database. Start: node server.js
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');
const ROOMS = { hello: { title: 'ㄴㅁ 인사방', limit: 100 }, talk: { title: '마음껏 수다방', limit: Infinity }, gym: { title: '다이어트방', limit: Infinity } };
const members = new Map(); // token -> {id, room, goal, stream, ...}; all ephemeral
const history = { hello: [], talk: [], gym: [] };
const exerciseNames = { squat: '스쿼트', treadmill: '런닝머신 걷기', fasting: '굶기' };
let turnIndex = 0, turnSeconds = 12, activeExercise = '기구를 골라 보세요';
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let s = '';
  for await (const chunk of req) { s += chunk.toString(); if (s.length > 5000) throw new Error('요청이 너무 큽니다.'); }
  try { return JSON.parse(s || '{}'); } catch { throw new Error('잘못된 요청입니다.'); }
}
function inRoom(room) { return [...members.values()].filter(m => m.room === room); }
function count() { return Object.fromEntries(Object.keys(ROOMS).map(r => [r, inRoom(r).length])); }
function sse(res, type, payload) {
  if (!res || res.destroyed || res.writableEnded) return;
  try { res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* disconnected */ }
}
function publish(room, type, payload) {
  for (const m of inRoom(room)) if (m.stream) sse(m.stream, type, payload);
}
function publicMembers(room) { return inRoom(room).map(m => ({ id: m.id, nickname: 'ㄴㅁ', x: m.x, y: m.y })); }
function snapshot(room) { return { members: publicMembers(room), counts: count(), gym: gymSnapshot() }; }
function gymSnapshot() {
  const people = inRoom('gym');
  return { activeId: people.length ? people[turnIndex % people.length].id : null, seconds: turnSeconds, exercise: activeExercise };
}
function broadcastRooms() {
  for (const room of Object.keys(ROOMS)) publish(room, 'presence', snapshot(room));
}
function drop(token) {
  const m = members.get(token); if (!m) return;
  clearTimeout(m.cleanup); clearTimeout(m.initialTimer);
  if (m.stream && !m.stream.destroyed && !m.stream.writableEnded) m.stream.end();
  const wasGym = m.room === 'gym';
  members.delete(token);
  if (wasGym) { const len = inRoom('gym').length; turnIndex = len ? turnIndex % len : 0; if (!len) turnSeconds = 12; activeExercise = '기구를 골라 보세요'; }
  broadcastRooms();
}
function addMessage(room, m, text) {
  const item = { id: crypto.randomUUID(), nickname: 'ㄴㅁ', text, at: Date.now(), userId: m.id };
  history[room].push(item); if (history[room].length > 60) history[room].shift();
  publish(room, 'message', item);
  return item;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { counts: count() });
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const info = await body(req);
      const room = typeof info.room === 'string' ? info.room : '';
      if (!ROOMS[room]) return json(res, 400, { error: '존재하지 않는 방입니다.' });
      if (inRoom(room).length >= ROOMS[room].limit) return json(res, 409, { error: '1번 방이 100명으로 가득 찼어요. 자리가 나면 다시 입장해 주세요.' });
      let goal = null;
      if (room === 'gym') {
        goal = Number(info.goal);
        if (!Number.isFinite(goal) || goal < 20 || goal > 300) return json(res, 400, { error: '목표 몸무게를 20~300kg 사이로 입력해 주세요.' });
        goal = Math.round(goal * 10) / 10;
      }
      const token = crypto.randomBytes(32).toString('hex');
      const slot = inRoom(room).length;
      const m = { token, id: crypto.randomUUID(), room, goal, x: 15 + (slot % 7) * 12, y: 73 + (Math.floor(slot / 7) % 3) * 5, stream: null, lastAction: 0, lastMove: 0, lastWorkout: 0, reps: { squat: 0, treadmill: 0, fasting: 0 }, cleanup: null, initialTimer: null };
      members.set(token, m);
      m.initialTimer = setTimeout(() => { if (!m.stream) drop(token); }, 15000);
      broadcastRooms();
      return json(res, 200, { token, myId: m.id, room, goal, myCounts: m.reps, messages: history[room], snapshot: snapshot(room) });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const token = url.searchParams.get('token'); const m = members.get(token);
      if (!m) return json(res, 401, { error: '접속이 만료되었습니다. 다시 입장해 주세요.' });
      clearTimeout(m.cleanup); clearTimeout(m.initialTimer);
      if (m.stream && !m.stream.destroyed && !m.stream.writableEnded) m.stream.end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': 'same-origin' });
      m.stream = res;
      sse(res, 'presence', snapshot(m.room));
      if (m.room === 'gym') sse(res, 'gym', gymSnapshot());
      res.on('close', () => {
        if (m.stream === res) { m.stream = null; clearTimeout(m.cleanup); m.cleanup = setTimeout(() => drop(token), 8000); }
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const data = await body(req); const m = members.get(data.token);
      if (!m) return json(res, 401, { error: '방에 다시 입장해 주세요.' });
      const now = Date.now();
      if (data.action === 'move') {
        if (now - m.lastMove < 270) return json(res, 429, { error: '천천히 이동해 주세요.' });
        const x = Number(data.x), y = Number(data.y);
        if (![x, y].every(Number.isFinite) || x < 7 || x > 93 || y < 67 || y > 87) return json(res, 400, { error: '이동할 수 없는 곳이에요.' });
        m.x = Math.round(x); m.y = Math.round(y); m.lastMove = now;
        publish(m.room, 'move', { userId: m.id, x: m.x, y: m.y });
        return json(res, 200, { ok: true });
      }
      if (m.room === 'gym' && data.action === 'workout') {
        const exercise = typeof data.exercise === 'string' ? data.exercise : '';
        if (!(exercise in exerciseNames)) return json(res, 400, { error: '올바른 운동 기구를 선택해 주세요.' });
        if (gymSnapshot().activeId !== m.id) return json(res, 403, { error: '아직 내 차례가 아니에요. 잠시 뒤 다시 눌러 주세요.' });
        if (now - m.lastWorkout < 280) return json(res, 429, { error: '버튼을 조금만 천천히 눌러 주세요.' });
        m.lastWorkout = now;
        m.reps[exercise] += 1;
        activeExercise = exerciseNames[exercise];
        const location = { squat: [24,79], treadmill: [77,79], fasting: [50,79] }[exercise];
        m.x = location[0]; m.y = location[1];
        publish('gym', 'workout', { userId: m.id, exercise, count: m.reps[exercise] });
        publish('gym', 'gym', gymSnapshot());
        return json(res, 200, { ok: true, count: m.reps[exercise] });
      }
      if (now - m.lastAction < 900) return json(res, 429, { error: '조금 천천히 보내 주세요.' });
      m.lastAction = now;
      if (m.room === 'hello' && data.action === 'greet') {
        const msg = addMessage(m.room, m, 'ㄴㅁ'); return json(res, 200, { ok: true, id: msg.id });
      }
      if (m.room === 'gym' && data.action === 'cheer') {
        publish('gym', 'cheer', { userId: m.id });
        return json(res, 200, { ok: true });
      }
      if (m.room === 'talk' && data.action === 'chat') {
        const text = typeof data.text === 'string' ? data.text.trim().replace(/[\u0000-\u001f\u007f]/g, ' ') : '';
        if (!text || text.length > 200) return json(res, 400, { error: '메시지는 1~200자로 써 주세요.' });
        const msg = addMessage(m.room, m, text); return json(res, 200, { ok: true, id: msg.id });
      }
      return json(res, 403, { error: '이 방에서는 사용할 수 없는 기능이에요.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/leave') {
      const data = await body(req); if (data.token) drop(data.token);
      return json(res, 200, { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '지원하지 않는 요청입니다.' });
    const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(ROOT, '.' + name);
    if (!(target === ROOT || target.startsWith(ROOT + path.sep))) return json(res, 403, { error: '접근 불가' });
    fs.stat(target, (err, stat) => {
      if (err || !stat.isFile()) return json(res, 404, { error: '파일이 없습니다.' });
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=120' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    });
  } catch (err) { return json(res, 400, { error: err.message || '오류가 발생했어요.' }); }
});

setInterval(() => {
  const people = inRoom('gym');
  if (!people.length) return;
  turnSeconds -= 1;
  if (turnSeconds <= 0) { turnIndex = (turnIndex + 1) % people.length; turnSeconds = 12; activeExercise = '기구를 골라 보세요'; }
  publish('gym', 'gym', gymSnapshot());
}, 1000).unref();
setInterval(() => {
  for (const m of members.values()) if (m.stream) sse(m.stream, 'ping', { time: Date.now() });
}, 20000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`선영아 사랑해야 → http://localhost:${PORT}`));
