const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.resolve(__dirname, 'public');

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR, { index: false }));

/* ══════════════════════════════════════════
   ADMIN CONFIGURATION
   
   Set credentials via environment variables:
     EXAM_USERS=username1:password1,username2:password2
   
   Or add them directly to USERS below.
   Each user gets their own session.
══════════════════════════════════════════ */
const USERS = parseUsers(process.env.EXAM_USERS || 'student1:pass123,student2:pass456');

function parseUsers(raw) {
    const map = {};
    raw.split(',').forEach(entry => {
        const [u, p] = entry.trim().split(':');
        if (u && p) map[u.trim()] = p.trim();
    });
    return map;
}

// Active sessions: token → { username, startedAt }
const sessions = {};

/* ── SEB VERIFICATION (optional but recommended) ──────────────
   Set SEB_EXAM_KEY in your .env to the Browser Exam Key hash
   from your SEB config. Requests without a valid key are blocked.
   Leave empty to skip SEB verification (development only).
   
   See: https://safeexambrowser.org/developer/seb-config-key.html
─────────────────────────────────────────────────────────────── */
const SEB_EXAM_KEY = process.env.SEB_EXAM_KEY || '';

function verifySEB(req) {
    if (!SEB_EXAM_KEY) return true; // not enforced in dev
    const sebHeader = req.headers['x-safeexambrowser-requesthash']; // X-SafeExamBrowser-RequestHash
    if (!sebHeader) return false;
    // SEB hash = SHA256( URL + SEB_EXAM_KEY )
    const url  = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const hash = crypto.createHash('sha256').update(url + SEB_EXAM_KEY).digest('hex');
    return hash === sebHeader;
}

/* ── LOGIN ────────────────────────────────────────────────────
   POST /api/login   { username, password }
   Returns { ok, token, displayName } or { ok: false, error }
─────────────────────────────────────────────────────────────── */
app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ ok: false, error: 'Введіть логін та пароль.' });
    }

    const stored = USERS[username];
    if (!stored || stored !== password) {
        console.log(`[login] FAILED  user="${username}" ip=${req.ip}`);
        return res.status(401).json({ ok: false, error: 'Невірний логін або пароль.' });
    }

    // Revoke any existing session for this user
    for (const [tok, s] of Object.entries(sessions)) {
        if (s.username === username) delete sessions[tok];
    }

    const token = crypto.randomBytes(24).toString('hex');
    sessions[token] = { username, startedAt: Date.now() };

    console.log(`[login] OK      user="${username}" token=${token.slice(0, 8)}…`);
    res.json({ ok: true, token, displayName: username });
});

/* ── AUTH MIDDLEWARE ──────────────────────────────────────── */
function requireAuth(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token || !sessions[token]) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.session = sessions[token];
    next();
}

/* ── SESSION / EXAM DATA ──────────────────────────────────── */
app.get('/api/session/:id', requireAuth, (req, res) => {
    res.json({
        sessionId:       req.params.id,
        student:         { name: req.session.username, code: req.params.id.slice(-8) },
        startedAt:       req.session.startedAt,
        durationSeconds: 7200,
        subjects
    });
});

/* ── SAVE ANSWER ─────────────────────────────────────────── */
app.post('/api/session/:id/answer', requireAuth, (req, res) => {
    const { questionId, answer } = req.body;
    console.log(`[answer] user="${req.session.username}" q=${questionId} a=${JSON.stringify(answer)}`);
    res.json({ ok: true });
});

/* ── SUBMIT ─────────────────────────────────────────────── */
app.post('/api/session/:id/submit', requireAuth, (req, res) => {
    const answered = Object.keys(req.body.answers || {}).length;
    console.log(`[submit] user="${req.session.username}" answered=${answered}`);
    // Invalidate session after submission
    delete sessions[Object.entries(sessions).find(([, s]) => s.username === req.session.username)?.[0]];
    res.json({ ok: true, message: 'Тест завершено успішно' });
});

/* ── HEALTH ─────────────────────────────────────────────── */
app.get('/health', (req, res) => res.send('OK'));

/* ── SPA CATCH-ALL ──────────────────────────────────────── */
app.get('*', (req, res) => {
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(index)) return res.status(500).send('index.html not found');
    res.sendFile(index);
});

app.listen(PORT, () => {
    console.log(`[ready] NMT on port ${PORT}`);
    console.log(`[users] ${Object.keys(USERS).join(', ')}`);
    if (!SEB_EXAM_KEY) console.warn('[warn]  SEB_EXAM_KEY not set — SEB verification disabled');
});

/* ── QUESTION DATA ────────────────────────────────────────── */
const subjects = [
    { id:'ukr',     title:'Українська мова та література', shortTitle:'Укр. мова',  questions: generateQuestions('ukr',     36) },
    { id:'math',    title:'Математика',                    shortTitle:'Математика', questions: generateQuestions('math',    30) },
    { id:'history', title:'Історія України',               shortTitle:'Історія',   questions: generateQuestions('history', 36) }
];

function generateQuestions(subjectId, count) {
    return Array.from({ length: count }, (_, i) => ({
        id:      `${subjectId}_${i + 1}`,
        number:  i + 1,
        type:    i < count - 6 ? 'single' : (i < count - 2 ? 'multi' : 'open'),
        text:    getQuestionText(subjectId, i),
        options: i < count - 2
            ? ['А','Б','В','Г'].map(l => ({ label: l, text: `Варіант відповіді ${l} для завдання ${i + 1}` }))
            : null,
        answer: null
    }));
}

function getQuestionText(subject, idx) {
    const t = {
        ukr:     [`Укажіть рядок, у якому всі слова написані правильно (завдання ${idx+1}).`,
                  `Визначте синонім до слова «відповідь» (завдання ${idx+1}).`,
                  `Оберіть речення з правильно розставленими розділовими знаками (завдання ${idx+1}).`],
        math:    [`Знайдіть значення виразу 2x²+3x−5 при x=2 (завдання ${idx+1}).`,
                  `Розв'яжіть рівняння log₂(x+3)=4 (завдання ${idx+1}).`,
                  `Обчисліть похідну f(x)=sin(3x)·eˣ (завдання ${idx+1}).`],
        history: [`Коли була проголошена незалежність України? (завдання ${idx+1})`,
                  `Хто підписав Переяславську угоду з боку України? (завдання ${idx+1})`,
                  `Укажіть рік заснування Київської Русі (завдання ${idx+1}).`]
    };
    const arr = t[subject] || t.ukr;
    return arr[idx % arr.length];
}
