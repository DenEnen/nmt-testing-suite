'use strict';
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR, { index: false }));

/* ══════════════════════════════════════════════════════════
   ADMIN CONFIGURATION
   
   Set via environment variables (Render dashboard or .env):
   
   EXAM_TOKENS  — comma-separated  token:DisplayName  pairs.
                  The admin puts each student's token into
                  their personal .seb file startURL:
                  https://yourapp.onrender.com/?t=TOKEN
                  Example:
                  EXAM_TOKENS=abc123:Іваненко Олег,xyz789:Петренко Анна

   SEB_EXAM_KEY — Browser Exam Key shown in SEB Preferences →
                  Exam tab after saving your .seb config.
                  Leave empty to skip BEK validation (dev only).

   QUIT_URL     — URL SEB auto-quits on after submission.
                  Must match quitURL in the .seb config.
                  Default: /submitted
══════════════════════════════════════════════════════════ */
const EXAM_TOKENS = parseTokens(process.env.EXAM_TOKENS || 'demo123:Тестовий Учасник');
const SEB_KEY     = (process.env.SEB_EXAM_KEY || '').trim();
const QUIT_PATH   = process.env.QUIT_URL || '/submitted';

function parseTokens(raw) {
    const map = {};
    raw.split(',').forEach(entry => {
        const colon = entry.indexOf(':');
        if (colon > 0) {
            const token = entry.slice(0, colon).trim();
            const name  = entry.slice(colon + 1).trim();
            if (token && name) map[token] = name;
        }
    });
    return map;
}

/* ── ACTIVE SESSIONS ─────────────────────────────────────
   token → { name, startedAt, answers }
─────────────────────────────────────────────────────────── */
const sessions = {};

/* ══════════════════════════════════════════════════════════
   MIDDLEWARE 1 — SEB User-Agent Gate
   
   Blocks any browser that is not Safe Exam Browser.
   SEB always includes "SebBrowser" (Win) or "SEB" (macOS/iOS)
   in its user-agent string.
   
   Per docs: checking the UA is the minimum integration step.
   Combined with BEK validation below it is fully secure.
══════════════════════════════════════════════════════════ */
function requireSEB(req, res, next) {
    // Allow health-check and static assets without SEB check
    if (req.path === '/health') return next();
    if (!req.path.startsWith('/api')) return next(); // static files pass through

    const ua = req.headers['user-agent'] || '';
    if (!/SEB|SebBrowser/i.test(ua)) {
        console.warn(`[blocked] non-SEB access from UA="${ua}" path=${req.path}`);
        return res.status(403).json({
            ok: false,
            error: 'Цей ресурс доступний лише через Safe Exam Browser.'
        });
    }
    next();
}
app.use(requireSEB);

/* ══════════════════════════════════════════════════════════
   MIDDLEWARE 2 — Browser Exam Key Validation
   
   SEB sends X-SafeExamBrowser-RequestHash on every request.
   Hash = SHA256( requestURL + BrowserExamKey )
   
   Per docs: copy the BEK from SEB Preferences → Exam tab
   and set it as SEB_EXAM_KEY env var.
   
   Only runs when SEB_EXAM_KEY is configured (skips in dev).
══════════════════════════════════════════════════════════ */
function validateBEK(req, res, next) {
    if (!SEB_KEY) return next(); // dev mode: skip

    const bekHeader = req.headers['x-safeexambrowser-requesthash'];
    if (!bekHeader) {
        return res.status(403).json({ ok: false, error: 'Missing SEB request hash.' });
    }

    // Reconstruct the exact URL SEB used (including query string)
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host  = req.headers['x-forwarded-host']  || req.get('host');
    const fullUrl = `${proto}://${host}${req.originalUrl}`;

    const expected = crypto.createHash('sha256')
        .update(fullUrl + SEB_KEY)
        .digest('hex');

    if (bekHeader !== expected) {
        console.warn(`[bek-fail] expected=${expected.slice(0,16)}… got=${bekHeader.slice(0,16)}…`);
        return res.status(403).json({ ok: false, error: 'Invalid SEB Browser Exam Key.' });
    }
    next();
}
app.use('/api', validateBEK);

/* ══════════════════════════════════════════════════════════
   API — SESSION INIT
   
   SEB opens: startURL = https://exam.com/?t=STUDENT_TOKEN
   JS on the page reads ?t= and calls GET /api/session?t=TOKEN
   No login form — the .seb config IS the authentication.
══════════════════════════════════════════════════════════ */
app.get('/api/session', (req, res) => {
    const token = (req.query.t || '').trim();

    if (!token) {
        return res.status(400).json({ ok: false, error: 'Token missing.' });
    }

    const name = EXAM_TOKENS[token];
    if (!name) {
        console.warn(`[auth] unknown token="${token}"`);
        return res.status(401).json({ ok: false, error: 'Недійсний токен сесії.' });
    }

    // Revoke any previous session for this student
    for (const [k, s] of Object.entries(sessions)) {
        if (s.name === name) delete sessions[k];
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions[sessionId] = { name, token, startedAt: Date.now(), answers: {} };

    console.log(`[session] START name="${name}" sid=${sessionId.slice(0,8)}…`);
    res.json({
        ok:              true,
        sessionId,
        student:         { name },
        startedAt:       sessions[sessionId].startedAt,
        durationSeconds: 7200,
        subjects
    });
});

/* ── SAVE ANSWER ─────────────────────────────────────────── */
app.post('/api/session/:sid/answer', (req, res) => {
    const s = sessions[req.params.sid];
    if (!s) return res.status(401).json({ ok: false, error: 'Session not found.' });

    const { questionId, answer } = req.body;
    if (answer != null) s.answers[questionId] = answer;
    else delete s.answers[questionId];

    console.log(`[answer] "${s.name}" q=${questionId} a=${JSON.stringify(answer)}`);
    res.json({ ok: true });
});

/* ── SUBMIT ──────────────────────────────────────────────── */
app.post('/api/session/:sid/submit', (req, res) => {
    const s = sessions[req.params.sid];
    if (!s) return res.status(401).json({ ok: false, error: 'Session not found.' });

    const total    = Object.keys(req.body.answers || {}).length;
    const duration = Math.round((Date.now() - s.startedAt) / 1000);
    console.log(`[submit] "${s.name}" answered=${total} duration=${duration}s`);

    delete sessions[req.params.sid]; // invalidate session

    // Tell the client to navigate to QUIT_PATH, which SEB will detect
    // and automatically quit (per SEB docs: quitURL feature)
    res.json({ ok: true, quitUrl: QUIT_PATH });
});

/* ══════════════════════════════════════════════════════════
   QUIT URL ENDPOINT
   
   Per SEB docs: set quitURL in the .seb config to this path.
   When SEB navigates here it automatically exits kiosk mode.
   No more "press Ctrl+Q" instructions needed.
   
   quitURLConfirm = false  →  quits without asking the student.
══════════════════════════════════════════════════════════ */
app.get(QUIT_PATH, (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Тест завершено</title>
  <style>
    body { margin:0; font-family: 'Open Sans', sans-serif;
           background:#c61036; color:#fff;
           display:flex; align-items:center; justify-content:center;
           height:100vh; text-align:center; }
    h1 { font-size:28px; margin-bottom:10px; }
    p  { font-size:15px; opacity:.85; }
  </style>
</head>
<body>
  <div>
    <svg viewBox="0 0 80 80" fill="none" width="64" height="64" style="margin-bottom:16px;">
      <circle cx="40" cy="40" r="38"
              stroke="rgba(255,255,255,0.35)" stroke-width="2"
              fill="rgba(255,255,255,0.12)"/>
      <path d="M24 40l12 12 20-24" stroke="#fff" stroke-width="3.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>Тест успішно завершено!</h1>
    <p>Ваші відповіді збережено.<br>Safe Exam Browser закривається…</p>
  </div>
</body>
</html>`);
});

/* ── HEALTH ──────────────────────────────────────────────── */
app.get('/health', (_req, res) => res.send('OK'));

/* ── SPA CATCH-ALL ───────────────────────────────────────── */
app.get('*', (req, res) => {
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(index)) return res.status(500).send('index.html not found');
    res.sendFile(index);
});

app.listen(PORT, () => {
    console.log(`[ready]  NMT on port ${PORT}`);
    console.log(`[tokens] ${Object.keys(EXAM_TOKENS).length} student(s) registered`);
    console.log(`[bek]    SEB_EXAM_KEY ${SEB_KEY ? 'SET ✓' : 'NOT SET — validation disabled'}`);
    console.log(`[quit]   Quit URL: ${QUIT_PATH}`);
});

/* ── QUESTION DATA ───────────────────────────────────────── */
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
            ? ['А','Б','В','Г'].map(l => ({ label: l, text: `Варіант відповіді ${l} — завдання ${i + 1}` }))
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
        history: [`Коли проголошено незалежність України? (завдання ${idx+1})`,
                  `Хто підписав Переяславську угоду з боку України? (завдання ${idx+1})`,
                  `Укажіть рік заснування Київської Русі (завдання ${idx+1}).`]
    };
    const arr = t[subject] || t.ukr;
    return arr[idx % arr.length];
}
