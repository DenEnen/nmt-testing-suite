/* ═══════════════════════════════════════════════════════
   NMT Testing Suite — Frontend Logic

   Auth flow (SEB-native, per docs):
     1. Admin puts token in startURL: ?t=STUDENT_TOKEN
     2. Page loads → JS reads ?t= → calls GET /api/session
     3. Server validates token + Browser Exam Key header
     4. Exam starts — no login form, no password prompt

   Quit flow (SEB-native, per docs):
     1. Student submits → POST /api/session/:sid/submit
     2. Server returns { quitUrl: '/submitted' }
     3. JS navigates to quitUrl
     4. SEB detects quitURL match → auto-quits kiosk mode
═══════════════════════════════════════════════════════ */
'use strict';

const NMT = (() => {

    let state = {
        sessionId:         null,
        studentName:       '',
        subjects:          [],
        activeSubjectIdx:  0,
        activeQuestionIdx: 0,
        answers:           {},
        bookmarks:         {},
        timerSeconds:      7200,
        timerInterval:     null,
        timerVisible:      true,
        finished:          false,
        expanded:          false
    };

    /* ─── BOOT ──────────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', () => {
        buildWatermarks();
        wireUserMenu();
        wireKeyboard();
        initSession();
    });

    /* ─── SESSION INIT (SEB URL-TOKEN AUTH) ─────────────── */
    async function initSession() {
        // Read the student token the admin embedded in startURL
        const token = new URLSearchParams(location.search).get('t') || '';

        if (!token) {
            showInitError(
                'Токен сесії відсутній у URL.\n\n' +
                'Переконайтеся, що Ви відкрили тест через правильно налаштований ' +
                'файл Safe Exam Browser (.seb), виданий адміністратором.'
            );
            return;
        }

        try {
            const res  = await fetch(`/api/session?t=${encodeURIComponent(token)}`);
            const data = await res.json();

            if (!data.ok) {
                showInitError(data.error || 'Невідома помилка сервера.');
                return;
            }

            state.sessionId    = data.sessionId;
            state.studentName  = data.student.name;
            state.subjects     = data.subjects;
            state.timerSeconds = data.durationSeconds;

            document.getElementById('display-user-name').textContent = state.studentName;
            document.getElementById('total-count').textContent =
                state.subjects.reduce((n, s) => n + s.questions.length, 0);

            document.getElementById('screen-init').style.display        = 'none';
            document.getElementById('main-test-interface').style.display = 'block';

            renderTabs();
            renderGrid();
            renderQuestion();
            startTimer();

        } catch (err) {
            showInitError('Не вдалося з\'єднатися з сервером. Перевірте мережеве з\'єднання.');
        }
    }

    function showInitError(msg) {
        document.getElementById('init-loading').style.display = 'none';
        const errEl = document.getElementById('init-error');
        errEl.style.display = 'block';
        document.getElementById('init-error-msg').textContent = msg;
    }

    /* ─── WATERMARKS ─────────────────────────────────────── */
    function buildWatermarks() {
        const wm = document.getElementById('watermarks');
        for (let i = 0; i < 80; i++) {
            const el = document.createElement('div');
            el.className   = 'wm-text';
            el.textContent = 'НМТ 2026';
            wm.appendChild(el);
        }
    }

    /* ─── USER MENU ──────────────────────────────────────── */
    function wireUserMenu() {
        document.getElementById('user-menu-btn').addEventListener('click', () => {
            const m = document.getElementById('logout-menu');
            m.style.display = m.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('#user-menu-btn'))
                document.getElementById('logout-menu').style.display = 'none';
        });
    }

    /* ─── KEYBOARD NAV ───────────────────────────────────── */
    function wireKeyboard() {
        document.addEventListener('keydown', e => {
            if (state.finished || !state.sessionId) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next();
            if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev();
        });
    }

    /* ─── TIMER ──────────────────────────────────────────── */
    function startTimer() {
        renderTimerText();
        state.timerInterval = setInterval(() => {
            if (state.timerSeconds <= 0) {
                clearInterval(state.timerInterval);
                confirmFinish(true);
                return;
            }
            state.timerSeconds--;
            renderTimerText();
        }, 1000);
    }

    function renderTimerText() {
        const s   = state.timerSeconds;
        const h   = Math.floor(s / 3600);
        const m   = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const txt = h > 0
            ? `${h}:${pad(m)}:${pad(sec)}`
            : `${m}:${pad(sec)}`;
        const el = document.getElementById('main-timer');
        el.textContent = state.timerVisible ? txt : '--:--';
        el.style.color = (s <= 300 && state.timerVisible) ? 'var(--primary-red)' : '';
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function toggleTimer() {
        state.timerVisible = !state.timerVisible;
        document.getElementById('icon-eye-open').style.display   = state.timerVisible ? '' : 'none';
        document.getElementById('icon-eye-closed').style.display = state.timerVisible ? 'none' : '';
        renderTimerText();
    }

    /* ─── SUBJECT TABS ───────────────────────────────────── */
    function renderTabs() {
        const container = document.getElementById('subject-tabs');
        container.innerHTML = '';
        state.subjects.forEach((subj, i) => {
            const hasBookmark = subj.questions.some(q => state.bookmarks[q.id]);
            const div = document.createElement('div');
            div.textContent = subj.shortTitle;
            if (i === state.activeSubjectIdx) div.classList.add('active');
            if (hasBookmark) div.classList.add('bookmarked');
            div.onclick = () => switchSubject(i);
            container.appendChild(div);
        });
    }

    function switchSubject(idx) {
        state.activeSubjectIdx  = idx;
        state.activeQuestionIdx = 0;
        renderTabs();
        renderGrid();
        renderQuestion();
    }

    /* ─── QUESTION GRID ──────────────────────────────────── */
    function renderGrid() {
        const subj = currentSubject();
        const grid = document.getElementById('nav-grid');
        grid.innerHTML = '';
        subj.questions.forEach((q, i) => {
            const btn = document.createElement('div');
            btn.className = [
                'grid-btn',
                i === state.activeQuestionIdx ? 'current'    : '',
                state.answers[q.id]  != null  ? 'saved'      : '',
                state.bookmarks[q.id]          ? 'bookmarked' : ''
            ].filter(Boolean).join(' ');
            btn.textContent = q.number;
            btn.onclick = () => jumpTo(i);
            grid.appendChild(btn);
        });
    }

    function jumpTo(idx) {
        state.activeQuestionIdx = idx;
        renderGrid();
        renderQuestion();
    }

    /* ─── QUESTION RENDER ────────────────────────────────── */
    function renderQuestion() {
        const subj  = currentSubject();
        const q     = subj.questions[state.activeQuestionIdx];
        const total = subj.questions.length;
        const idx   = state.activeQuestionIdx;

        document.getElementById('breadcrumb-q').textContent     = q.number;
        document.getElementById('breadcrumb-total').textContent  = total;
        document.getElementById('nav-counter').textContent       = `${idx + 1} / ${total}`;
        document.getElementById('subject-title').textContent     = subj.title;

        // Bookmark label
        const hasBookmark = !!state.bookmarks[q.id];
        document.getElementById('bm-text').textContent = hasBookmark
            ? 'Видалити цю сторінку з закладок'
            : 'Додати цю сторінку до закладок';
        document.getElementById('bookmark-btn').classList.toggle('saved', hasBookmark);

        // Nav buttons
        document.getElementById('btn-prev').disabled = (idx === 0);
        document.getElementById('btn-next').disabled = (idx === total - 1);

        // Render question content
        const container = document.getElementById('questions-container');
        container.innerHTML = '';
        const slide = document.createElement('div');
        slide.className = 'question-slide active';
        slide.innerHTML = buildQuestionHTML(q);
        container.appendChild(slide);

        restoreAnswer(q);
    }

    function buildQuestionHTML(q) {
        const labels = {
            single: 'Оберіть одну правильну відповідь',
            multi:  'Оберіть декілька правильних відповідей',
            open:   'Впишіть відповідь у поле'
        };

        let html = `
            <div class="instruction-box">${labels[q.type] || ''}</div>
            <div class="question-number">Завдання ${q.number}</div>
            <div class="question-text">${q.text}</div>`;

        if (q.type === 'single' || q.type === 'multi') {
            const type = q.type === 'multi' ? 'checkbox' : 'radio';
            html += `<div class="answers-list">`;
            q.options.forEach(opt => {
                html += `
                    <label class="answer-item">
                        <input type="${type}" name="q_${q.id}" value="${opt.label}"
                               onchange="NMT.onAnswerChange('${q.id}')">
                        <span class="marker">${opt.label}</span>
                        ${opt.text}
                    </label>`;
            });
            html += `</div>`;
        } else if (q.type === 'open') {
            html += `
                <input type="text" class="short-answer-input" id="open-${q.id}"
                       placeholder="Введіть відповідь"
                       oninput="NMT.onAnswerChange('${q.id}')">`;
        }

        html += `
            <button class="btn-save" id="save-btn-${q.id}"
                    onclick="NMT.saveAnswer('${q.id}')">Зберегти відповідь</button>
            <div class="saved-msg" id="saved-msg-${q.id}">✓ Відповідь збережено</div>`;

        return html;
    }

    function restoreAnswer(q) {
        const saved = state.answers[q.id];
        if (saved == null) return;

        if (q.type === 'single') {
            const el = document.querySelector(`input[name="q_${q.id}"][value="${saved}"]`);
            if (el) el.checked = true;
        } else if (q.type === 'multi' && Array.isArray(saved)) {
            saved.forEach(v => {
                const el = document.querySelector(`input[name="q_${q.id}"][value="${v}"]`);
                if (el) el.checked = true;
            });
        } else if (q.type === 'open') {
            const el = document.getElementById(`open-${q.id}`);
            if (el) el.value = saved;
        }
        setSaveBtn(q.id, 'saved');
    }

    /* ─── ANSWER SAVE ────────────────────────────────────── */
    function onAnswerChange(qId) {
        setSaveBtn(qId, 'ready');
        const msg = document.getElementById(`saved-msg-${qId}`);
        if (msg) msg.style.display = 'none';
    }

    function setSaveBtn(qId, s) {
        const btn = document.getElementById(`save-btn-${qId}`);
        if (!btn) return;
        btn.classList.remove('ready', 'saved');
        if (s) btn.classList.add(s);
    }

    function saveAnswer(qId) {
        const q = currentSubject().questions.find(q => q.id === qId);
        if (!q) return;

        let value = null;
        if (q.type === 'single') {
            const el = document.querySelector(`input[name="q_${qId}"]:checked`);
            if (el) value = el.value;
        } else if (q.type === 'multi') {
            const els = [...document.querySelectorAll(`input[name="q_${qId}"]:checked`)];
            if (els.length) value = els.map(e => e.value);
        } else if (q.type === 'open') {
            const el = document.getElementById(`open-${qId}`);
            if (el && el.value.trim()) value = el.value.trim();
        }

        if (value != null) {
            state.answers[qId] = value;
            setSaveBtn(qId, 'saved');
            const msg = document.getElementById(`saved-msg-${qId}`);
            if (msg) msg.style.display = 'block';
        } else {
            delete state.answers[qId];
            setSaveBtn(qId, '');
        }

        document.getElementById('answered-count').textContent = Object.keys(state.answers).length;
        renderGrid();
        renderTabs();

        // Fire-and-forget to server
        fetch(`/api/session/${state.sessionId}/answer`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ questionId: qId, answer: value })
        }).catch(() => {});
    }

    /* ─── BOOKMARK ───────────────────────────────────────── */
    function toggleBookmark() {
        const q = currentQuestion();
        if (state.bookmarks[q.id]) delete state.bookmarks[q.id];
        else state.bookmarks[q.id] = true;
        renderGrid();
        renderTabs();
        renderQuestion();
    }

    /* ─── NAVIGATION ─────────────────────────────────────── */
    function prev() {
        if (state.activeQuestionIdx > 0) {
            state.activeQuestionIdx--;
            renderGrid();
            renderQuestion();
        }
    }

    function next() {
        const total = currentSubject().questions.length;
        if (state.activeQuestionIdx < total - 1) {
            state.activeQuestionIdx++;
            renderGrid();
            renderQuestion();
        }
    }

    /* ─── FINISH MODAL ───────────────────────────────────── */
    function openFinishModal() {
        const totalQ    = state.subjects.reduce((n, s) => n + s.questions.length, 0);
        const answeredQ = Object.keys(state.answers).length;
        document.getElementById('answered-count').textContent = answeredQ;
        document.getElementById('total-count').textContent    = totalQ;

        const unanswered = [];
        state.subjects.forEach(subj =>
            subj.questions.forEach(q => {
                if (state.answers[q.id] == null)
                    unanswered.push(`${subj.shortTitle} №${q.number}`);
            })
        );
        const box = document.getElementById('unanswered-warning');
        if (unanswered.length) {
            document.getElementById('unanswered-list').textContent = unanswered.join(', ');
            box.style.display = 'flex';
        } else {
            box.style.display = 'none';
        }
        document.getElementById('finish-modal-overlay').style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('finish-modal-overlay').style.display = 'none';
    }

    async function confirmFinish(auto = false) {
        closeModal();
        clearInterval(state.timerInterval);
        state.finished = true;

        try {
            const res  = await fetch(`/api/session/${state.sessionId}/submit`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ answers: state.answers })
            });
            const data = await res.json();

            /* ── SEB QUIT URL (per SEB docs) ──────────────────────
               Server returns the quitUrl configured in .seb config.
               Navigating here makes SEB auto-exit kiosk mode.
               No "press Ctrl+Q" instructions needed.
            ──────────────────────────────────────────────────────── */
            if (data.quitUrl) {
                window.location.href = data.quitUrl;
                return;
            }
        } catch (_) {
            // If server unreachable, navigate to quit path directly
            window.location.href = '/submitted';
        }
    }

    /* ─── TOP NAV ────────────────────────────────────────── */
    function showExam() {
        document.getElementById('test-area').style.display         = 'flex';
        document.getElementById('instruction-area').style.display  = 'none';
        document.getElementById('plashka-container').style.display = 'block';
        document.getElementById('nav-exam').classList.add('active');
        document.getElementById('nav-instruction').classList.remove('active');
    }

    function showInstruction() {
        document.getElementById('test-area').style.display         = 'none';
        document.getElementById('instruction-area').style.display  = 'block';
        document.getElementById('plashka-container').style.display = 'none';
        document.getElementById('nav-exam').classList.remove('active');
        document.getElementById('nav-instruction').classList.add('active');
    }

    /* ─── EXPAND PANEL ───────────────────────────────────── */
    function toggleExpand() {
        state.expanded = !state.expanded;
        const rp = document.getElementById('right-panel');
        if (rp) rp.style.display = state.expanded ? 'none' : '';
        document.getElementById('icon-expand').style.display   = state.expanded ? 'none' : '';
        document.getElementById('icon-collapse').style.display = state.expanded ? '' : 'none';
    }

    /* ─── LOGOUT ─────────────────────────────────────────── */
    function logout() {
        // In SEB, this will be blocked by URL filtering / quit password.
        // Shown here only as a fallback for dev/admin access.
        if (confirm('Вийти з тесту? Прогрес може бути втрачено.')) {
            clearInterval(state.timerInterval);
            window.location.href = '/submitted';
        }
    }

    /* ─── HELPERS ────────────────────────────────────────── */
    function currentSubject()  { return state.subjects[state.activeSubjectIdx]; }
    function currentQuestion() { return currentSubject().questions[state.activeQuestionIdx]; }

    return {
        prev, next, jumpTo, switchSubject,
        saveAnswer, onAnswerChange,
        toggleBookmark, toggleTimer, toggleExpand,
        openFinishModal, closeModal, confirmFinish,
        showExam, showInstruction, logout
    };

})();
