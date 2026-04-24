# Fuck Off Gains Tracker

Personal workout logger. Time-first set tracking, WHOOP recovery and strain fields, 10-second countdown with audio beeps at 30s and 40s, per-exercise averages, previous-session comparisons, CSV and JSON export.

Data is stored in the browser's localStorage (private to your device and browser). Use the Export CSV button in the History view to back up your sessions.

## Deploy to Vercel

Pick one of the two paths below. The GitHub path is easier if you're not a developer.

### Option A: GitHub + Vercel (no terminal required)

1. Create a free GitHub account at github.com if you don't have one.
2. Go to github.com/new, create a new repository called `fuck-off-gains`. Set it to Private. Skip adding a README.
3. On the new empty repo page, click "uploading an existing file". Drag this entire folder's contents (not the folder itself, the contents) into the upload area. Commit.
4. Go to vercel.com and sign in with GitHub.
5. Click "Add New" then "Project".
6. Find `fuck-off-gains` in the list, click Import.
7. Leave all settings as default. Vercel auto-detects Vite. Click Deploy.
8. Wait about 60 seconds. You'll get a URL like `fuck-off-gains.vercel.app`.

### Option B: Vercel CLI (requires Node.js on your computer)

1. Install Node.js from nodejs.org (LTS version).
2. Open Terminal, navigate to this folder: `cd /path/to/fogt`
3. Run: `npm install`
4. Run: `npx vercel`
5. Follow the prompts. First run will ask you to log in. Accept the defaults.
6. You get a production URL.

## Add to iPhone home screen

1. Open the Vercel URL in Safari on your iPhone.
2. Tap the share icon at the bottom.
3. Scroll down, tap "Add to Home Screen".
4. Name it whatever you like. Tap Add.
5. Launch from the home screen icon. It'll run full-screen like a native app.

## Local development

```
npm install
npm run dev
```

Opens at http://localhost:5173.

## Back up your data

In the app, tap History (clock icon, top right), then CSV. Save the file to your Files app or email it to yourself. Your sessions are stored in browser localStorage only, so a CSV backup is the only copy off-device. Recommend backing up after each session.
