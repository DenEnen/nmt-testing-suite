/* ═══════════════════════════════════════════
   NMT Testing Suite — Frontend Logic
═══════════════════════════════════════════ */

const NMT = (() => {
  // ─── State ──────────────────────────────────────────────────
  let state = {
    sessionId: getSessionId(),
    subjects: [],
    activeSubjectIdx: 0,
    activeQuestionIdx: 0,
    answers: {},       // { questionId: value }
    timerSeconds: 7200,
    timerInterval: null,
    finished: false
  };

  // ─── Init ────────────────────────────────────────────────────
  async function init() {
    const data = await fetchSession(state.sessionId);
    state.subjects = data.subjects;
    state.timerSeconds = data.durationSeconds;

    document.getElementById('studentName').textContent = data.student.name;
    document.getElementById('studentCode').textContent = `№ ${data.student.code}`;

    renderTabs();
    renderGrid();
    renderQuestion();
    startTimer();
  }

  function getSessionId() {
    const p = new URLSearchParams(location.search);
    return p.get('session') || 'demo';
  }

  async function fetchSession(id) {
    const r = await fetch(`/api/session/${id}`);
    return r.json();
  }

  // ─── Timer ───────────────────────────────────────────────────
  function startTimer() {
    renderTimer();
    state.timerInterval = setInterval(() => {
      state.timerSeconds--;
      renderTimer();
      if (state.timerSeconds <= 0) {
        clearInterval(state.timerInterval);
        confirmFinish(true);
      }
    }, 1000);
  }

  function renderTimer() {
    const s = state.timerSeconds;
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    document.getElementById('timer').textContent = `${h}:${m}:${sec}`;

    const block = document.getElementById('timerBlock');
    if (s <= 300) block.classList.add('warning');
    else block.classList.remove('warning');
  }

  // ─── Tabs ────────────────────────────────────────────────────
  function renderTabs() {
    const container = document.getElementById('subjectTabs');
    container.innerHTML = '';
    state.subjects.forEach((subj, i) => {
      const answered = subj.questions.filter(q => state.answers[q.id] != null).length;
      const total    = subj.questions.length;
      const btn = document.createElement('button');
      btn.className = `subject-tab${i === state.activeSubjectIdx ? ' active' : ''}`;
      btn.innerHTML = `${subj.shortTitle} <span class="tab-progress">${answered}/${total}</span>`;
      btn.onclick = () => switchSubject(i);
      container.appendChild(btn);
    });
  }

  function switchSubject(idx) {
    state.activeSubjectIdx = idx;
    state.activeQuestionIdx = 0;
    renderTabs();
    renderGrid();
    renderQuestion();
  }

  // ─── Grid ────────────────────────────────────────────────────
  function renderGrid() {
    const subj = currentSubject();
    const grid = document.getElementById('questionGrid');
    grid.innerHTML = '';

    subj.questions.forEach((q, i) => {
      const cell = document.createElement('div');
      const isCurrent = i === state.activeQuestionIdx;
      const isAnswered = state.answers[q.id] != null;
      cell.className = `grid-cell${isCurrent ? ' current' : isAnswered ? ' answered' : ''}`;
      cell.textContent = q.number;
      cell.onclick = () => jumpTo(i);
      grid.appendChild(cell);
    });

    const answered = subj.questions.filter(q => state.answers[q.id] != null).length;
    const total = subj.questions.length;
    const pct = total ? Math.round((answered / total) * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = `${answered} з ${total} завдань`;
  }

  function jumpTo(idx) {
    state.activeQuestionIdx = idx;
    renderGrid();
    renderQuestion();
  }

  // ─── Question ────────────────────────────────────────────────
  function renderQuestion() {
    const subj = currentSubject();
    const q = subj.questions[state.activeQuestionIdx];
    const total = subj.questions.length;
    const idx = state.activeQuestionIdx;

    document.getElementById('questionBadge').textContent = `Завдання ${q.number}`;
    document.getElementById('navCounter').textContent = `${idx + 1} / ${total}`;
    document.getElementById('questionText').textContent = q.text;

    const typeMap = { single: 'Одна правильна відповідь', multi: 'Декілька правильних відповідей', open: 'Відкрита відповідь' };
    document.getElementById('questionTypeLabel').textContent = typeMap[q.type] || '';

    // Nav buttons
    document.getElementById('btnPrev').disabled = idx === 0;
    document.getElementById('btnNext').disabled = idx === total - 1;

    // Show correct section
    document.getElementById('optionsList').style.display   = q.type === 'single' ? '' : 'none';
    document.getElementById('optionsMulti').style.display  = q.type === 'multi'  ? '' : 'none';
    document.getElementById('openAnswer').style.display    = q.type === 'open'   ? '' : 'none';

    if (q.type === 'single') renderSingleOptions(q);
    if (q.type === 'multi')  renderMultiOptions(q);
    if (q.type === 'open')   renderOpen(q);
  }

  function renderSingleOptions(q) {
    const list = document.getElementById('optionsList');
    const current = state.answers[q.id];
    list.innerHTML = '';
    q.options.forEach(opt => {
      const selected = current === opt.label;
      const item = document.createElement('div');
      item.className = `option-item${selected ? ' selected' : ''}`;
      item.innerHTML = `<div class="option-label">${opt.label}</div><div class="option-text">${opt.text}</div>`;
      item.onclick = () => { saveAnswer(q.id, opt.label); renderQuestion(); renderGrid(); renderTabs(); sendAnswer(q.id, opt.label); };
      list.appendChild(item);
    });
  }

  function renderMultiOptions(q) {
    const list = document.getElementById('optionsMulti');
    const current = state.answers[q.id] || [];
    list.innerHTML = '';
    q.options.forEach(opt => {
      const selected = current.includes(opt.label);
      const item = document.createElement('div');
      item.className = `option-item${selected ? ' selected' : ''}`;
      item.innerHTML = `<div class="option-label">${opt.label}</div><div class="option-text">${opt.text}</div>`;
      item.onclick = () => {
        const prev = state.answers[q.id] || [];
        const next = prev.includes(opt.label)
          ? prev.filter(v => v !== opt.label)
          : [...prev, opt.label];
        saveAnswer(q.id, next.length ? next : null);
        renderQuestion(); renderGrid(); renderTabs();
        sendAnswer(q.id, next);
      };
      list.appendChild(item);
    });
  }

  function renderOpen(q) {
    document.getElementById('openInput').value = state.answers[q.id] || '';
  }

  // ─── Answers ─────────────────────────────────────────────────
  function saveAnswer(id, val) {
    if (val === null || (Array.isArray(val) && val.length === 0)) {
      delete state.answers[id];
    } else {
      state.answers[id] = val;
    }
  }

  function saveOpen(val) {
    const q = currentQuestion();
    saveAnswer(q.id, val.trim() || null);
    renderGrid(); renderTabs();
    sendAnswer(q.id, val.trim());
  }

  async function sendAnswer(questionId, answer) {
    try {
      await fetch(`/api/session/${state.sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, answer })
      });
    } catch (_) { /* offline — answers are in-memory */ }
  }

  // ─── Navigation ──────────────────────────────────────────────
  function prev() {
    if (state.activeQuestionIdx > 0) {
      state.activeQuestionIdx--;
      renderGrid(); renderQuestion();
    }
  }

  function next() {
    const total = currentSubject().questions.length;
    if (state.activeQuestionIdx < total - 1) {
      state.activeQuestionIdx++;
      renderGrid(); renderQuestion();
    }
  }

  // ─── Finish ──────────────────────────────────────────────────
  function finish() {
    const totalQ = state.subjects.reduce((a, s) => a + s.questions.length, 0);
    const answeredQ = Object.keys(state.answers).length;
    document.getElementById('answeredCount').textContent = answeredQ;
    document.getElementById('totalCount').textContent = totalQ;
    document.getElementById('finishModal').style.display = 'flex';
  }

  function closeModal() {
    document.getElementById('finishModal').style.display = 'none';
  }

  async function confirmFinish(auto = false) {
    closeModal();
    clearInterval(state.timerInterval);
    state.finished = true;

    try {
      await fetch(`/api/session/${state.sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: state.answers })
      });
    } catch (_) {}

    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    document.getElementById('confirmCode').textContent = code;
    document.getElementById('successScreen').style.display = 'flex';
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function currentSubject() { return state.subjects[state.activeSubjectIdx]; }
  function currentQuestion() { return currentSubject().questions[state.activeQuestionIdx]; }

  // ─── Keyboard ────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (state.finished) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev();
    if (['а','б','в','г','a','b','c','d','1','2','3','4'].includes(e.key.toLowerCase())) {
      const map = { 'а':'А','a':'А','1':'А', 'б':'Б','b':'Б','2':'Б', 'в':'В','c':'В','3':'В', 'г':'Г','d':'Г','4':'Г' };
      const label = map[e.key.toLowerCase()];
      if (label) {
        const q = currentQuestion();
        if (q.type === 'single') {
          saveAnswer(q.id, label); renderQuestion(); renderGrid(); renderTabs(); sendAnswer(q.id, label);
        }
      }
    }
  });

  // Public API
  return { init, prev, next, finish, closeModal, confirmFinish, saveOpen, switchSubject };
})();

document.addEventListener('DOMContentLoaded', () => NMT.init());
