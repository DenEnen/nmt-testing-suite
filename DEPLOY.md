# NMT Testing Suite — Deployment Guide
## Ukrainian NMT UI Replica for Safe Exam Browser

---

## Project Structure

```
nmt-testing-suite/
├── server.js             ← Express server (API + static files)
├── package.json
├── render.yaml           ← Render.com auto-deploy config
├── nmt-exam.seb.xml      ← Safe Exam Browser config (rename → .seb)
├── DEPLOY.md             ← This file
└── public/
    ├── index.html        ← Exam UI shell
    ├── css/nmt.css       ← NMT visual styles
    └── js/nmt.js         ← Exam logic, timer, answer saving
```

---

## Part 1 — Deploy to Render.com

### Why a server is required
SEB enforces **HTTPS** for all exam URLs. Render.com provides free HTTPS out of the box,
which is why a static file host alone is not sufficient — you need the Node.js server.

---

### Step 1 — Push to GitHub

```bash
cd nmt-testing-suite
git init
git add .
git commit -m "Initial NMT testing suite"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/nmt-testing-suite.git
git push -u origin main
```

---

### Step 2 — Create Render Web Service

1. Go to **https://render.com** → sign in (free account is enough).
2. Click **"New +"** → **"Web Service"**.
3. Connect your GitHub account and select the `nmt-testing-suite` repo.
4. Render auto-detects `render.yaml` — confirm the settings:

| Setting | Value |
|---|---|
| Environment | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | `Free` |

5. Click **"Create Web Service"**.
6. Wait ~2 minutes for the first deploy to finish.
7. Your URL will be: `https://nmt-testing-suite.onrender.com`
   (Render may add a random suffix — copy the actual URL from the dashboard.)

---

### Step 3 — Test the deployment

Open in a regular browser first:
```
https://nmt-testing-suite.onrender.com/?session=demo
```
You should see the full NMT exam interface with a countdown timer.

---

### Step 4 — Redeploy after changes

Any `git push` to `main` triggers an automatic redeploy on Render.

---

## Part 2 — Configure Safe Exam Browser

### Step 1 — Install SEB

| OS | Download |
|---|---|
| Windows | https://safeexambrowser.org/download_en.html |
| macOS | https://safeexambrowser.org/download_en.html |

Minimum version: **SEB 3.3+**

---

### Step 2 — Edit the SEB config file

Open `nmt-exam.seb.xml` in any text editor and make these replacements:

**A) Set your exam URL**
```xml
<!-- BEFORE -->
<string>https://YOUR_RENDER_URL.onrender.com/?session=demo</string>

<!-- AFTER (example) -->
<string>https://nmt-testing-suite-abc1.onrender.com/?session=demo</string>
```

**B) Set the URL filter to your domain**
```xml
<!-- BEFORE -->
<string>YOUR_RENDER_URL.onrender.com</string>

<!-- AFTER -->
<string>nmt-testing-suite-abc1.onrender.com</string>
```

**C) Set a quit password**

Generate a SHA-256 hash of your chosen password:

```bash
# Linux / macOS:
echo -n 'MySecretQuitPassword123' | sha256sum

# Windows PowerShell:
[System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes('MySecretQuitPassword123')
  )
).Replace('-','').ToLower()
```

Replace the placeholder in the config:
```xml
<string>REPLACE_WITH_SHA256_HASH_OF_YOUR_QUIT_PASSWORD</string>
```

---

### Step 3 — Convert XML → SEB file

The `.seb` format is a **password-encrypted plist**. You can't just rename the `.xml`.

**Option A — Use SEB's built-in editor (recommended)**

1. Open **Safe Exam Browser**.
2. Go to **Preferences** (Windows: `Win+P` | macOS: `⌘,`).
3. Switch to the **Config File** tab.
4. Paste your settings manually using the GUI fields.
5. Under **File → Save Settings As…** → save as `nmt-exam.seb`.
6. Set an **admin password** when prompted (this encrypts the file).

**Option B — Use SEB Configuration Tool**

Download the standalone SEB Config Tool from:
`https://safeexambrowser.org/download_en.html`

It lets you import XML settings and export a proper `.seb` file.

---

### Step 4 — Load the SEB config

```
File → Open Settings → select nmt-exam.seb
```

SEB will restart and lock down the browser, opening your exam URL.

---

### Step 5 — Quitting SEB

- Press `Ctrl + Q` (Windows) or `⌘ + Q` (macOS).
- Enter the quit password you set in Step 2C.

---

## Part 3 — Customising the Exam Content

Edit `server.js` — the `subjects` array at the bottom of the file.

### Adding real questions

```js
{
  id: 'ukr',
  title: 'Українська мова',
  shortTitle: 'Укр. мова',
  color: '#1a56a4',
  questions: [
    {
      id: 'ukr_1',
      number: 1,
      type: 'single',          // 'single' | 'multi' | 'open'
      text: 'Укажіть рядок, у якому всі слова написано правильно.',
      options: [
        { label: 'А', text: 'безпека, непорозуміння, аджe' },
        { label: 'Б', text: 'щотижня, утричі, аніж' },
        { label: 'В', text: 'зпочатку, навпіл, набагато' },
        { label: 'Г', text: 'позаминулий, вщент, ізнову' }
      ],
      answer: null
    },
    // open question example:
    {
      id: 'ukr_36',
      number: 36,
      type: 'open',
      text: 'Запишіть числову відповідь.',
      options: null,
      answer: null
    }
  ]
}
```

### Adding a session query parameter

Pass a student ID via URL so each student gets their own session:
```
https://your-app.onrender.com/?session=STUDENT_CODE
```

The server logs answers tagged with the session ID:
```
Session STUDENT_CODE — Q ukr_1: Б
```

For persistent storage, replace the `console.log` calls in `server.js` with a
database write (e.g. **PostgreSQL** via Render's managed DB add-on, or **SQLite**).

---

## Part 4 — SEB Browser Key (optional security)

SEB adds a special `X-SafeExamBrowser-RequestHash` HTTP header to every request.
You can verify it on the server to block access from regular browsers:

```js
// In server.js — add this middleware:
app.use((req, res, next) => {
  const sebKey = req.headers['x-safeexambrowser-requesthash'];
  if (!sebKey) {
    return res.status(403).send('Access only via Safe Exam Browser');
  }
  next();
});
```

The hash changes per-request; to validate it properly see:
https://safeexambrowser.org/developer/seb-config-key.html

---

## Quick-Start Checklist

- [ ] Push code to GitHub
- [ ] Create Web Service on Render.com
- [ ] Copy your `*.onrender.com` URL
- [ ] Edit `nmt-exam.seb.xml` — set URL, filter, quit-password hash
- [ ] Generate `.seb` file via SEB Preferences or Config Tool
- [ ] Open SEB → load `.seb` → verify exam loads
- [ ] Add real questions to `server.js` → `git push`

---

## Free Tier Notes (Render.com)

| Limitation | Detail |
|---|---|
| Cold starts | Free services spin down after 15 min of inactivity — first load takes ~30 s |
| Avoid cold starts | Upgrade to **Starter ($7/mo)** or ping the URL every 10 min via UptimeRobot (free) |
| Bandwidth | 100 GB/month — more than enough for any exam session |
| Custom domain | Not on free tier; use the provided `*.onrender.com` domain |
