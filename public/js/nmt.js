/* ═══════════════════════════════════════════
   NMT Testing Suite — Frontend Logic
   Auth: Bearer token via POST /api/login
   Cheat detection: handled entirely by SEB
═══════════════════════════════════════════ */

const NMT = (() => {

    let state = {
        token:             null,
        sessionId:         null,
        displayName:       '',
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

    /* ─── BOOT ────────────────────────────── */
    document.addEventListener('DOMContentLoaded', () => {
        // User menu toggle
        document.getElementById('user-menu-btn').addEventListener('click', () => {
            const m = document.getElementById('logout-menu');
            m.style.display = m.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('#user-menu-btn'))
                document.getElementById('logout-menu').style.display = 'none';
        });

        // Keyboard navigation during test
        document.addEventListener('keydown', e => {
            if (state.finished || !state.token) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next();
            if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev();
        });

        // Focus first input
        document.getElementById('login-username').focus();

        buildWatermarks('НМТ 2026');
    });

    /* ─── WATERMARKS ──────────────────────── */
    function buildWatermarks(text) {
        const wm = document.getElementById('watermarks');
        for (let i = 0; i < 80; i++) {
            const el = document.createElement('div');
            el.className = 'wm-text';
            el.textContent = text;
            wm.appendChild(el);
        }
    }

    /* ─── LOGIN ───────────────────────────── */
    function togglePassword() {
        const inp  = document.getElementById('login-password');
        const show = document.getElementById('icon-pw-show');
        const hide = document.getElementById('icon-pw-hide');
        const isHidden = inp.type === 'password';
        inp.type       = isHidden ? 'text' : 'password';
        show.style.display = isHidden ? 'none' : '';
        hide.style.display = isHidden ? '' : 'none';
    }

    async function login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errEl    = document.getElementById('login-error');
        const btn      = document.getElementById('btn-login');

        errEl.style.display = 'none';

        if (!username || !password) {
            showLoginError('Будь ласка, введіть логін та пароль.');
            return;
        }

        btn.disabled    = true;
        btn.textContent = 'Вхід…';

        try {
            const res  = await fetch('/api/login', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!data.ok) {
                showLoginError(data.error || 'Невірний логін або пароль.');
                return;
            }

            state.token       = data.token;
            state.displayName = data.displayName;
            state.sessionId   = `${username}_${Date.now()}`;

            await loadExam();

        } catch (err) {
            showLoginError('Помилка з\'єднання з сервером. Спробуйте ще раз.');
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Увійти';
        }
    }

    function showLoginError(msg) {
        const el = document.getElementById('login-error');
        el.textContent   = msg;
        el.style.display = 'block';
        document.getElementById('login-password').value = '';
        document.getElementById('login-password').focus();
    }

    /* ─── LOAD EXAM ───────────────────────── */
    async function loadExam() {
        const res  = await fetch(`/api/session/${state.sessionId}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        state.subjects     = data.subjects;
        state.timerSeconds = data.durationSeconds;

        document.getElementById('display-user-name').textContent = state.displayName;
        document.getElementById('total-count').textContent =
            state.subjects.reduce((s, sub) => s + sub.questions.length, 0);

        document.getElementById('screen-login').style.display        = 'none';
        document.getElementById('main-test-interface').style.display = 'block';

        renderTabs();
        renderGrid();
        renderQuestion();
        startTimer();
    }

    /* ─── TIMER ───────────────────────────── */
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
            ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
            : `${m}:${String(sec).padStart(2,'0')}`;
        const el  = document.getElementById('main-timer');
        el.textContent = state.timerVisible ? txt : '--:--';
        el.style.color = (s <= 300 && state.timerVisible) ? 'var(--primary-red)' : '';
    }

    function toggleTimer() {
        state.timerVisible = !state.timerVisible;
        document.getElementById('icon-eye-open').style.display   = state.timerVisible ? '' : 'none';
        document.getElementById('icon-eye-closed').style.display = state.timerVisible ? 'none' : '';
        renderTimerText();
    }

    /* ─── TABS ────────────────────────────── */
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

    /* ─── GRID ────────────────────────────── */
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

    /* ─── QUESTION ────────────────────────── */
    function renderQuestion() {
        const subj  = currentSubject();
        const q     = subj.questions[state.activeQuestionIdx];
        const total = subj.questions.length;
        const idx   = state.activeQuestionIdx;

        document.getElementById('breadcrumb-q').textContent     = q.number;
        document.getElementById('breadcrumb-total').textContent = total;
        document.getElementById('nav-counter').textContent      = `${idx + 1} / ${total}`;
        document.getElementById('subject-title').textContent    = subj.title;

        const bm = document.getElementById('bookmark-btn');
        document.getElementById('bm-text').textContent = state.bookmarks[q.id]
            ? 'Видалити цю сторінку з закладок'
            : 'Додати цю сторінку до закладок';
        bm.classList.toggle('saved', !!state.bookmarks[q.id]);

        const prevBtn = document.getElementById('btn-prev');
        const nextBtn = document.getElementById('btn-next');
        prevBtn.disabled = (idx === 0);
        nextBtn.disabled = (idx === total - 1);

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
            <div class="instruction-box">${labels[q.type] || 'Завдання'}</div>
            <div class="question-number">Завдання ${q.number}</div>
            <div class="question-text">${q.text}</div>`;

        if (q.type === 'single' || q.type === 'multi') {
            const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
            html += `<div class="answers-list">`;
            q.options.forEach(opt => {
                html += `
                    <label class="answer-item">
                        <input type="${inputType}" name="q_${q.id}" value="${opt.label}"
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
            const inp = document.querySelector(`input[name="q_${q.id}"][value="${saved}"]`);
            if (inp) inp.checked = true;
        } else if (q.type === 'multi' && Array.isArray(saved)) {
            saved.forEach(v => {
                const inp = document.querySelector(`input[name="q_${q.id}"][value="${v}"]`);
                if (inp) inp.checked = true;
            });
        } else if (q.type === 'open') {
            const inp = document.getElementById(`open-${q.id}`);
            if (inp) inp.value = saved;
        }
        setSaveBtnState(q.id, 'saved');
    }

    /* ─── ANSWER INTERACTION ──────────────── */
    function onAnswerChange(qId) {
        setSaveBtnState(qId, 'ready');
        const msg = document.getElementById(`saved-msg-${qId}`);
        if (msg) msg.style.display = 'none';
    }

    function setSaveBtnState(qId, s) {
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
            const inp = document.querySelector(`input[name="q_${qId}"]:checked`);
            if (inp) value = inp.value;
        } else if (q.type === 'multi') {
            const inps = [...document.querySelectorAll(`input[name="q_${qId}"]:checked`)];
            if (inps.length) value = inps.map(c => c.value);
        } else if (q.type === 'open') {
            const inp = document.getElementById(`open-${qId}`);
            if (inp && inp.value.trim()) value = inp.value.trim();
        }

        if (value != null) {
            state.answers[qId] = value;
            setSaveBtnState(qId, 'saved');
            const msg = document.getElementById(`saved-msg-${qId}`);
            if (msg) msg.style.display = 'block';
        } else {
            delete state.answers[qId];
            setSaveBtnState(qId, '');
        }

        document.getElementById('answered-count').textContent = Object.keys(state.answers).length;
        renderGrid();
        renderTabs();

        fetch(`/api/session/${state.sessionId}/answer`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ questionId: qId, answer: value })
        }).catch(() => {});
    }

    /* ─── BOOKMARK ────────────────────────── */
    function toggleBookmark() {
        const q = currentQuestion();
        if (state.bookmarks[q.id]) delete state.bookmarks[q.id];
        else state.bookmarks[q.id] = true;
        renderGrid();
        renderTabs();
        renderQuestion();
    }

    /* ─── NAVIGATION ──────────────────────── */
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

    /* ─── FINISH ──────────────────────────── */
    function openFinishModal() {
        const totalQ    = state.subjects.reduce((s, sub) => s + sub.questions.length, 0);
        const answeredQ = Object.keys(state.answers).length;
        document.getElementById('answered-count').textContent = answeredQ;
        document.getElementById('total-count').textContent    = totalQ;

        const unanswered = [];
        state.subjects.forEach(subj => {
            subj.questions.forEach(q => {
                if (state.answers[q.id] == null)
                    unanswered.push(`${subj.shortTitle} #${q.number}`);
            });
        });
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
            await fetch(`/api/session/${state.sessionId}/submit`, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${state.token}`
                },
                body: JSON.stringify({ answers: state.answers })
            });
        } catch (_) {}

        state.token = null; // clear token after submit
        const code  = Math.random().toString(36).substring(2, 10).toUpperCase();
        document.getElementById('confirm-code').textContent        = code;
        document.getElementById('main-test-interface').style.display = 'none';
        document.getElementById('success-screen').style.display    = 'flex';
    }

    /* ─── TOP NAV ─────────────────────────── */
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

    /* ─── EXPAND ──────────────────────────── */
    function toggleExpand() {
        state.expanded = !state.expanded;
        const rp = document.getElementById('right-panel');
        if (rp) rp.style.display = state.expanded ? 'none' : '';
        document.getElementById('icon-expand').style.display   = state.expanded ? 'none' : '';
        document.getElementById('icon-collapse').style.display = state.expanded ? '' : 'none';
    }

    /* ─── LOGOUT ──────────────────────────── */
    function logout() {
        if (confirm('Ви впевнені, що хочете вийти?')) {
            clearInterval(state.timerInterval);
            state.token = null;
            location.reload();
        }
    }

    /* ─── HELPERS ─────────────────────────── */
    function currentSubject()  { return state.subjects[state.activeSubjectIdx]; }
    function currentQuestion() { return currentSubject().questions[state.activeQuestionIdx]; }

    return {
        login, togglePassword,
        prev, next, jumpTo, switchSubject,
        saveAnswer, onAnswerChange,
        toggleBookmark, toggleTimer, toggleExpand,
        openFinishModal, closeModal, confirmFinish,
        showExam, showInstruction, logout
    };

})();
