const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: load test session
app.get('/api/session/:id', (req, res) => {
  // Example session — replace with DB or file-based storage as needed
  res.json({
    sessionId: req.params.id,
    student: { name: 'Тест Учасник', code: '00000001' },
    startedAt: Date.now(),
    durationSeconds: 7200,
    subjects: subjects
  });
});

// API: save answers
app.post('/api/session/:id/answer', (req, res) => {
  const { questionId, answer } = req.body;
  console.log(`Session ${req.params.id} — Q${questionId}: ${answer}`);
  res.json({ ok: true });
});

// API: submit test
app.post('/api/session/:id/submit', (req, res) => {
  console.log(`Session ${req.params.id} submitted`);
  res.json({ ok: true, message: 'Тест завершено успішно' });
});

// Catch-all → serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NMT Testing Suite running on port ${PORT}`);
});

// ─── Demo data ───────────────────────────────────────────────────────────────
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
    options: i < count - 2 ? ['А', 'Б', 'В', 'Г'].map((l, j) => ({
      label: l,
      text: `Варіант відповіді ${l} для запитання ${i + 1}`
    })) : null,
    answer: null
  }));
}

function getQuestionText(subject, idx) {
  const templates = {
    ukr: [
      `Укажіть рядок, у якому всі слова написані правильно (запитання ${idx + 1}).`,
      `Визначте, яке слово є синонімом до слова «відповідь» (запитання ${idx + 1}).`,
      `Оберіть речення з правильно розставленими розділовими знаками (запитання ${idx + 1}).`
    ],
    math: [
      `Знайдіть значення виразу: 2x² + 3x − 5 при x = 2 (запитання ${idx + 1}).`,
      `Розв'яжіть рівняння: log₂(x + 3) = 4 (запитання ${idx + 1}).`,
      `Обчисліть похідну функції f(x) = sin(3x) · eˣ (запитання ${idx + 1}).`
    ],
    history: [
      `Коли була проголошена незалежність України? (запитання ${idx + 1})`,
      `Хто підписав Переяславську угоду з боку України? (запитання ${idx + 1})`,
      `Укажіть рік заснування Київської Русі (запитання ${idx + 1}).`
    ]
  };
  const arr = templates[subject] || templates.ukr;
  return arr[idx % arr.length];
}
