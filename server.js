const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Resolve public dir robustly ──────────────────────────────────────────────
const PUBLIC_DIR = path.resolve(__dirname, 'public');
console.log('[boot] public dir →', PUBLIC_DIR);
console.log('[boot] index.html exists?', fs.existsSync(path.join(PUBLIC_DIR, 'index.html')));

app.use(cors());
app.use(express.json());

// Serve static assets BEFORE the catch-all
app.use(express.static(PUBLIC_DIR, { index: false }));

// ── API ──────────────────────────────────────────────────────────────────────
app.get('/api/session/:id', (req, res) => {
  res.json({
    sessionId: req.params.id,
    student: { name: 'Тест Учасник', code: '00000001' },
    startedAt: Date.now(),
    durationSeconds: 7200,
    subjects: subjects
  });
});

app.post('/api/session/:id/answer', (req, res) => {
  const { questionId, answer } = req.body;
  console.log(`[answer] session=${req.params.id} q=${questionId} a=${JSON.stringify(answer)}`);
  res.json({ ok: true });
});

app.post('/api/session/:id/submit', (req, res) => {
  console.log(`[submit] session=${req.params.id}`);
  res.json({ ok: true, message: 'Тест завершено успішно' });
});

// Health-check for Render
app.get('/health', (req, res) => res.send('OK'));

// ── SPA catch-all: serve index.html for every non-API GET ────────────────────
app.get('*', (req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    return res.status(500).send(`index.html not found at ${index}`);
  }
  res.sendFile(index);
});

app.listen(PORT, () => {
  console.log(`[ready] NMT Testing Suite on port ${PORT}`);
});

// ── Demo data ────────────────────────────────────────────────────────────────
const subjects = [
  {
    id: 'ukr',
    title: 'Українська мова',
    shortTitle: 'Укр. мова',
    color: '#1a56a4',
    questions: generateQuestions('ukr', 36)
  },
  {
    id: 'math',
    title: 'Математика',
    shortTitle: 'Математика',
    color: '#0e7c3a',
    questions: generateQuestions('math', 30)
  },
  {
    id: 'history',
    title: 'Історія України',
    shortTitle: 'Історія',
    color: '#8b1a1a',
    questions: generateQuestions('history', 36)
  }
];

function generateQuestions(subjectId, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${subjectId}_${i + 1}`,
    number: i + 1,
    type: i < count - 6 ? 'single' : (i < count - 2 ? 'multi' : 'open'),
    text: getQuestionText(subjectId, i),
    options: i < count - 2 ? ['А', 'Б', 'В', 'Г'].map((l) => ({
      label: l,
      text: `Варіант відповіді ${l} для завдання ${i + 1}`
    })) : null,
    answer: null
  }));
}

function getQuestionText(subject, idx) {
  const templates = {
    ukr: [
      `Укажіть рядок, у якому всі слова написані правильно (завдання ${idx + 1}).`,
      `Визначте, яке слово є синонімом до слова «відповідь» (завдання ${idx + 1}).`,
      `Оберіть речення з правильно розставленими розділовими знаками (завдання ${idx + 1}).`
    ],
    math: [
      `Знайдіть значення виразу: 2x² + 3x − 5 при x = 2 (завдання ${idx + 1}).`,
      `Розв'яжіть рівняння: log₂(x + 3) = 4 (завдання ${idx + 1}).`,
      `Обчисліть похідну функції f(x) = sin(3x) · eˣ (завдання ${idx + 1}).`
    ],
    history: [
      `Коли була проголошена незалежність України? (завдання ${idx + 1})`,
      `Хто підписав Переяславську угоду з боку України? (завдання ${idx + 1})`,
      `Укажіть рік заснування Київської Русі (завдання ${idx + 1}).`
    ]
  };
  const arr = templates[subject] || templates.ukr;
  return arr[idx % arr.length];
}
