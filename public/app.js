'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const DEMO = !['http:', 'https:'].includes(location.protocol);
  const titles = { hello: 'ㄴㅁ 인사방', talk: '마음껏 수다방', gym: '다이어트방' };
  const descs = { hello: '말은 딱 한마디. 그래도 마음은 통하니까요.', talk: '우리들의 이야기', gym: '목표를 적고, 함께 차례로 움직여요.' };
  const colors = ['#d98679', '#718e79', '#b995b2', '#c2a06c', '#7f9fb5', '#b58488', '#989a69'];
  const state = { room: null, token: null, myId: null, members: [], messages: [], gym: null, goal: null, source: null };
  let toastTimer, gymDemoTimer, chantTimer = null, lastWorkoutClick = 0, workoutFxTimer = null;
  const emptyCounts = () => ({ squat: 0, treadmill: 0, fasting: 0 });
  state.myCounts = emptyCounts();

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3100);
  }
  for (const img of $$('.portrait-shell img')) {
    img.addEventListener('error', () => { img.hidden = true; img.style.display = 'none'; });
    if (img.complete && img.naturalWidth === 0) { img.hidden = true; img.style.display = 'none'; }
  }
  function setCounts(counts) {
    for (const room of Object.keys(titles)) {
      const el = $(`#count-${room}`);
      if (el) el.textContent = String(counts[room] ?? 0);
    }
    if (state.room) {
      $('#activeCount').textContent = String(counts[state.room] ?? state.members.length);
    }
  }
  async function refreshCounts() {
    if (DEMO) return;
    try { const result = await fetch('/api/status', { cache: 'no-store' }); if (result.ok) setCounts((await result.json()).counts); } catch { /* offline */ }
  }
  async function api(url, payload) {
    const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || '잠시 후 다시 시도해 주세요.');
    return data;
  }

  function openGoal() {
    $('#goalModal').hidden = false;
    $('#goalInput').value = '';
    setTimeout(() => $('#goalInput').focus(), 30);
  }
  function closeGoal() { $('#goalModal').hidden = true; }
  async function joinRoom(room, goal) {
    if (!titles[room]) return;
    if (room === 'gym' && goal == null) { openGoal(); return; }
    if (state.room) await leaveRoom(false);
    try {
      const response = DEMO ? {
        token: 'preview-only', myId: 'preview-me', room, goal,
        messages: [], snapshot: { members: [{ id: 'preview-me', nickname: 'ㄴㅁ', x: 46, y: 80 }], counts: { hello: room === 'hello' ? 1 : 0, talk: room === 'talk' ? 1 : 0, gym: room === 'gym' ? 1 : 0 }, gym: { activeId: room === 'gym' ? 'preview-me' : null, seconds: 12, exercise: '기구를 골라 보세요' }, myCounts: emptyCounts() }
      } : await api('/api/join', { room, goal });
      state.room = room; state.token = response.token; state.myId = response.myId;
      state.goal = response.goal; state.myCounts = response.myCounts || emptyCounts(); state.members = response.snapshot.members;
      state.messages = response.messages; state.gym = response.snapshot.gym;
      displayRoom(); renderPresence(response.snapshot); renderMessages();
      if (!DEMO) connectEvents();
      if (DEMO && room === 'gym') startDemoGym();
      if (!DEMO) history.replaceState(null, '', `${location.pathname}${room ? '?room=' + encodeURIComponent(room) : ''}`);
    } catch (error) { toast(error.message); }
  }
  function displayRoom() {
    $('#lobby').hidden = true; $('#roomView').hidden = false;
    $('#roomNum').textContent = `ROOM 0${['hello', 'talk', 'gym'].indexOf(state.room) + 1}`;
    $('#roomTitle').textContent = titles[state.room]; $('#roomDesc').textContent = descs[state.room];
    $('#panelTitle').textContent = state.room === 'hello' ? '오늘의 인사' : state.room === 'talk' ? '우리들의 대화' : '함께하는 운동';
    $('#regularActivity').hidden = state.room === 'gym'; $('#gymActivity').hidden = state.room !== 'gym';
    $('#helloControls').hidden = state.room !== 'hello'; $('#talkControls').hidden = state.room !== 'talk'; $('#gymControls').hidden = state.room !== 'gym';
    $('#templeScene').hidden = state.room !== 'hello'; $('#talkScene').hidden = state.room !== 'talk'; $('#gymScene').hidden = state.room !== 'gym';
    $('#scene').className = `scene scene-${state.room}`;
    $('#sceneNote').textContent = state.room === 'hello' ? '모두 ㄴㅁ · 인사만 해요' : state.room === 'talk' ? '우리들의 이야기 ♡' : '목표는 나만 알아요 · 함께 순서대로';
    $('#connectionTag').textContent = DEMO ? '혼자 놀기 · 체험판' : '실시간 연결 중';
    $('#sceneBottomHint').textContent = state.room === 'hello' ? '✿ ㄴㅁ 버튼으로 반갑게 인사해요' : state.room === 'talk' ? '♡ 스타들 아래에서 자유롭게 이야기해요' : '✿ 돌아가며 운동하고 서로 응원해요';
    if (state.room === 'gym') { $('#myGoal').textContent = `${state.goal} kg`; renderGym(); renderWorkoutCounts(); }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function connectEvents() {
    const source = new EventSource('/api/events?token=' + encodeURIComponent(state.token));
    state.source = source;
    source.addEventListener('open', () => { $('#connectionTag').textContent = '실시간 연결됨'; });
    source.addEventListener('presence', (e) => { if (state.room) renderPresence(JSON.parse(e.data)); });
    source.addEventListener('message', (e) => {
      const item = JSON.parse(e.data);
      state.messages.push(item); if (state.messages.length > 60) state.messages.shift();
      renderMessages(); showSpeechBubble(item);
    });
    source.addEventListener('gym', (e) => { state.gym = JSON.parse(e.data); renderGym(); renderAvatars(); });
    source.addEventListener('workout', (e) => { onWorkout(JSON.parse(e.data)); });
    source.addEventListener('move', (e) => {
      const data = JSON.parse(e.data);
      const person = state.members.find(m => m.id === data.userId);
      if (person) { person.x = data.x; person.y = data.y; renderAvatars(); }
    });
    source.addEventListener('cheer', (e) => {
      const data = JSON.parse(e.data);
      showSpeechBubble({ userId: data.userId, text: '힘내요! ♡' });
      if (data.userId === state.myId) toast('응원의 마음을 전했어요 ♡');
    });
    source.addEventListener('error', () => { if (state.room) $('#connectionTag').textContent = '연결 재시도 중…'; });
  }
  function renderPresence(payload) {
    state.members = payload.members || [];
    if (payload.gym) state.gym = payload.gym;
    setCounts(payload.counts || {});
    $('#memberSummary').textContent = `${state.members.length}명이 이 방에 있어요`;
    renderAvatars(); if (state.room === 'gym') renderGym();
  }
  function renderAvatars() {
    const layer = $('#avatars');
    const shown = state.members.slice(0, 28);
    const validIds = new Set(shown.map(p => p.id));
    for (const el of [...layer.querySelectorAll('.person')]) {
      if (!validIds.has(el.dataset.personId)) el.remove();
    }
    for (let i = 0; i < shown.length; i++) {
      const person = shown[i];
      let el = [...layer.querySelectorAll('.person')].find(n => n.dataset.personId === person.id);
      if (!el) {
        el = document.createElement('div');
        el.dataset.personId = person.id;
        el.innerHTML = `<span class="person-icon" style="--shirt:${colors[i % colors.length]};animation-delay:${(i % 5) * .3}s"><span class="person-head"></span><span class="person-body"></span></span><span class="person-name">ㄴㅁ</span>`;
        layer.append(el);
      }
      el.className = 'person' + (person.id === state.myId ? ' me' : '') + (state.room === 'gym' && state.gym?.activeId === person.id ? ' working' : '');
      const col = i % 7, row = Math.floor(i / 7);
      el.style.left = `${typeof person.x === 'number' ? person.x : 11 + col * 13}%`;
      el.style.top = `${typeof person.y === 'number' ? person.y : 66 + row * 8}%`;
      el.style.zIndex = String(10 + row);
    }
    layer.querySelector('.person-spare')?.remove();
    const extra = state.members.length - shown.length;
    if (extra > 0) {
      const note = document.createElement('div'); note.className = 'person-spare';
      note.textContent = `그리고 ㄴㅁ ${extra}명 더 ♡`; layer.append(note);
    }
  }
  function showSpeechBubble(item) {
    const el = $$('.person').find(node => node.dataset.personId === item.userId);
    if (!el) return;
    const old = el.querySelector('.person-bubble'); if (old) old.remove();
    const bubble = document.createElement('div'); bubble.className = 'person-bubble';
    bubble.textContent = item.text.length > 15 ? item.text.slice(0, 15) + '…' : item.text;
    el.append(bubble); setTimeout(() => bubble.remove(), 3100);
  }
  function renderMessages() {
    const feed = $('#messageFeed'); feed.replaceChildren();
    if (!state.messages.length) {
      const empty = document.createElement('div'); empty.className = 'empty-feed';
      empty.innerHTML = '<span>✿</span>아직 조용하네요.<br/>첫 번째 ㄴㅁ가 되어 주세요.';
      if (state.room === 'talk') empty.innerHTML = '<span>♡</span>아직 이야기가 없어요.<br/>먼저 말을 걸어 볼까요?';
      feed.append(empty); return;
    }
    for (const msg of state.messages) {
      const row = document.createElement('div');
      row.className = 'chat-msg' + (msg.userId === state.myId ? ' mine' : '');
      const avatar = document.createElement('div'); avatar.className = 'chat-avatar'; avatar.textContent = 'ㄴㅁ';
      const body = document.createElement('div'); body.className = 'chat-msg-body';
      const label = document.createElement('span'); label.className = 'chat-label';
      label.textContent = 'ㄴㅁ · ' + new Date(msg.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      const bubble = document.createElement('div'); bubble.className = 'chat-bubble'; bubble.textContent = msg.text;
      body.append(label, bubble); row.append(avatar, body); feed.append(row);
    }
    feed.scrollTop = feed.scrollHeight;
  }
  function renderWorkoutCounts() {
    for (const [name, count] of Object.entries(state.myCounts)) {
      $$(`[data-count="${name}"]`).forEach(el => { el.textContent = count.toLocaleString('ko-KR'); });
    }
  }
  function stopChant() {
    if (chantTimer) clearInterval(chantTimer);
    chantTimer = null;
    $('#fastingButtonLabel').textContent = '굶기 시작';
    $('#fastingSceneLabel').textContent = '시작하기';
    $('#gymChantNote').classList.remove('chanting');
  }
  function renderGym() {
    if (state.room !== 'gym' || !state.gym) return;
    const mine = state.gym.activeId === state.myId;
    $('#workoutState').textContent = mine ? '지금은 내 운동 차례예요! ♡' : '다른 ㄴㅁ가 운동 중이에요';
    $('#workoutExercise').textContent = state.gym.exercise || '기구를 골라 보세요';
    $('#workoutSeconds').textContent = state.gym.seconds;
    $$('.exercise-btn,.gym-station').forEach(btn => { btn.disabled = !mine; btn.title = mine ? '누르면 동작해요' : '내 운동 차례가 되면 누를 수 있어요'; });
    if (!mine && chantTimer) stopChant();
  }
  function showWorkoutScene(event) {
    if (state.room !== 'gym') return;
    const names = { squat: '스쿼트', treadmill: '걷기', fasting: '忍' };
    const person = state.members.find(m => m.id === event.userId);
    const locations = { squat: {x: 24, y: 79}, treadmill: {x: 77, y: 79}, fasting: {x: 50, y: 79} };
    if (person) { person.x = locations[event.exercise].x; person.y = locations[event.exercise].y; renderAvatars(); }
    const avatar = $$('.person').find(node => node.dataset.personId === event.userId);
    if (avatar) {
      avatar.classList.remove('doing-squat', 'doing-treadmill', 'doing-fasting');
      void avatar.offsetWidth;
      avatar.classList.add('doing-' + event.exercise);
      showSpeechBubble({ userId: event.userId, text: event.exercise === 'fasting' ? '나는 배부르다' : `${names[event.exercise]} ${event.count}!` });
      setTimeout(() => avatar.classList.remove('doing-' + event.exercise), 780);
    }
    const performer = $('#gymPerformer');
    performer.className = 'gym-performer';
    void performer.offsetWidth;
    performer.className = 'gym-performer acting ' + event.exercise;
    const effect = $('#gymEffect');
    effect.className = 'gym-special-effect';
    effect.textContent = event.exercise === 'fasting' ? '忍 · 나는 배부르다' : `${names[event.exercise]} ${event.count}!`;
    void effect.offsetWidth;
    effect.className = 'gym-special-effect visible ' + event.exercise;
    clearTimeout(workoutFxTimer);
    workoutFxTimer = setTimeout(() => { effect.className = 'gym-special-effect'; performer.className = 'gym-performer'; }, 1350);
    $$('.gym-station').forEach(btn => btn.classList.toggle('selected', btn.dataset.exercise === event.exercise));
  }
  function onWorkout(event) {
    if (state.room !== 'gym') return;
    if (!['squat','treadmill','fasting'].includes(event.exercise)) return;
    if (event.userId === state.myId) {
      state.myCounts[event.exercise] = event.count;
      renderWorkoutCounts();
      if (event.exercise === 'fasting') {
        $('#gymChantNote').textContent = `忍 · 나는 배부르다 ♡ (${event.count}번)`;
      }
    }
    showWorkoutScene(event);
  }
  async function doWorkout(exercise) {
    if (state.room !== 'gym' || !state.gym || state.gym.activeId !== state.myId) {
      stopChant(); toast('내 차례가 오면 운동할 수 있어요 ♡'); return;
    }
    if (Date.now() - lastWorkoutClick < 310) return;
    lastWorkoutClick = Date.now();
    try {
      if (DEMO) {
        const count = state.myCounts[exercise] + 1;
        state.gym.exercise = exercise === 'squat' ? '스쿼트' : exercise === 'treadmill' ? '런닝머신 걷기' : '굶기';
        renderGym(); onWorkout({ userId: state.myId, exercise, count });
      } else {
        await api('/api/action', { token: state.token, action: 'workout', exercise });
      }
    } catch (error) { stopChant(); toast(error.message); }
  }
  async function chooseWorkout(exercise) {
    if (exercise === 'fasting') {
      if (chantTimer) { stopChant(); return; }
      if (state.gym?.activeId !== state.myId) return toast('내 차례가 되면 시작할 수 있어요 ♡');
      $('#fastingButtonLabel').textContent = '굶기 멈추기';
      $('#fastingSceneLabel').textContent = '멈추기';
      $('#gymChantNote').classList.add('chanting');
      await doWorkout('fasting');
      if (state.room === 'gym' && state.gym?.activeId === state.myId) chantTimer = setInterval(() => doWorkout('fasting'), 2200);
    } else {
      if (chantTimer) stopChant();
      await doWorkout(exercise);
    }
  }
  function startDemoGym() {
    clearInterval(gymDemoTimer);
    gymDemoTimer = setInterval(() => {
      if (state.room !== 'gym' || !DEMO) return;
      state.gym.seconds -= 1;
      if (state.gym.seconds <= 0) state.gym.seconds = 12;
      renderGym();
    }, 1000);
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  let lastMove = 0;
  async function moveMe(event) {
    if (!state.room || event.target.closest('button, input, a')) return;
    if (Date.now() - lastMove < 320) return;
    const rect = $('#scene').getBoundingClientRect();
    const x = Math.round(clamp((event.clientX - rect.left) / rect.width * 100, 7, 93));
    const y = Math.round(clamp((event.clientY - rect.top) / rect.height * 100, 67, 87));
    lastMove = Date.now();
    const me = state.members.find(m => m.id === state.myId);
    if (me) { me.x = x; me.y = y; renderAvatars(); }
    if (!DEMO) try { await api('/api/action', { token: state.token, action: 'move', x, y }); } catch (e) { toast(e.message); }
  }
  async function sendAction(action, text) {
    if (!state.room) return;
    try {
      if (DEMO) {
        if (action === 'cheer') { showSpeechBubble({ userId: state.myId, text: '힘내요! ♡' }); toast('응원의 마음을 전했어요 ♡'); return; }
        const item = { id: String(Date.now()), userId: state.myId, nickname: 'ㄴㅁ', text: action === 'greet' ? 'ㄴㅁ' : text, at: Date.now() };
        state.messages.push(item); renderMessages(); showSpeechBubble(item); return;
      }
      await api('/api/action', { token: state.token, action, text });
    } catch (e) { toast(e.message); }
  }
  async function leaveRoom(showLobby = true) {
    clearInterval(gymDemoTimer); stopChant(); clearTimeout(workoutFxTimer); state.myCounts = emptyCounts();
    if (state.source) state.source.close(); state.source = null;
    const token = state.token;
    state.room = null; state.token = null; state.members = []; state.messages = []; state.gym = null;
    if (!DEMO && token) {
      try { await api('/api/leave', { token }); } catch { /* disconnect handled by timeout */ }
    }
    if (showLobby) {
      $('#roomView').hidden = true; $('#lobby').hidden = false;
      if (!DEMO) history.replaceState(null, '', location.pathname);
      refreshCounts(); window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  $('#scene').addEventListener('pointerdown', moveMe);
  $$('.exercise-btn,.gym-station').forEach(btn => btn.addEventListener('click', () => chooseWorkout(btn.dataset.exercise)));
  $('#cheerBtn').addEventListener('click', () => sendAction('cheer'));
  $$('.enter-btn').forEach(el => el.addEventListener('click', () => joinRoom(el.dataset.room)));
  $('#backBtn').addEventListener('click', () => leaveRoom());
  $('#homeBrand').addEventListener('click', (e) => { e.preventDefault(); if (state.room) leaveRoom(); else window.scrollTo({top:0,behavior:'smooth'}); });
  $('#cancelGoal').addEventListener('click', closeGoal);
  $('#goalModal').addEventListener('click', (e) => { if (e.target.id === 'goalModal') closeGoal(); });
  $('#goalForm').addEventListener('submit', (e) => {
    e.preventDefault(); const goal = Number($('#goalInput').value);
    if (!Number.isFinite(goal) || goal < 20 || goal > 300) return toast('목표 몸무게를 20~300kg 사이로 입력해 주세요.');
    closeGoal(); joinRoom('gym', Math.round(goal * 10) / 10);
  });
  $('#greetBtn').addEventListener('click', async () => {
    const btn = $('#greetBtn'); btn.disabled = true;
    await sendAction('greet'); setTimeout(() => { btn.disabled = false; }, 950);
  });
  $('#talkControls').addEventListener('submit', async (e) => {
    e.preventDefault(); const value = $('#chatInput').value.trim(); if (!value) return;
    $('#chatInput').value = ''; await sendAction('chat', value);
  });
  $('#shareBtn').addEventListener('click', async () => {
    if (DEMO) return toast('파일 미리보기는 공유할 수 없어요. 서버에 올리면 링크가 생겨요.');
    try {
      const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.room)}`;
      await navigator.clipboard.writeText(link); toast('방 링크를 복사했어요 ♡');
    } catch { toast('주소창에서 링크를 복사해 주세요.'); }
  });
  window.addEventListener('beforeunload', () => {
    if (!DEMO && state.token) navigator.sendBeacon('/api/leave', new Blob([JSON.stringify({ token: state.token })], { type: 'application/json' }));
  });
  if (DEMO) {
    $('#siteStatus').textContent = '혼자 놀 수 있는 체험판';
    toast('혼자 놀기 체험판이에요. 실시간 함께 놀기는 서버 실행 후 가능해요.');
  }
  refreshCounts(); setInterval(refreshCounts, 9000);
  const initial = new URLSearchParams(location.search).get('room');
  if (titles[initial]) joinRoom(initial);
})();
