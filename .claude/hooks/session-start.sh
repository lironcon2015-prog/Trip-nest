#!/bin/bash
# Session start: declare the always-on skill. A skill loads only when invoked
# or when its description matches, so "always active" has to be stated here;
# SessionStart output goes into the session context.
set -euo pipefail

cat <<'ACTIVATE'
פעיל בסשן הזה: .claude/skills/token-efficient-workflow/SKILL.md — קרא אותו עכשיו
ועבוד לפיו לאורך כל הסשן, בלי קשר לסוג המשימה. תמצית: חיפוש ממוקד לפני קריאה,
קריאת טווחים ולא קבצים שלמים, עריכה כירורגית ולא כתיבה מחדש, ואפס מילות קישור.
גובר עליו רק CLAUDE.md — ובפרט: סנכרון מול origin/main לפני כל עבודה, קידום גרסה, והבדיקות (CLAUDE.md, "Testing") לפני commit.
ACTIVATE

# In a remote session, make the server suites runnable: miniflare runs
# server/worker.js in the real workerd; fake-indexeddb gives the app modules a
# database in Node (tests/sync.mjs). One npm command for both — without a
# package.json, `npm install --no-save X` removes every package that is not X.
# node_modules/ is in .gitignore. Playwright and Chromium come with the image.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
  if [ ! -f node_modules/miniflare/package.json ] || [ ! -f node_modules/fake-indexeddb/package.json ]; then
    npm install --no-audit --no-fund --no-save --silent miniflare fake-indexeddb >/dev/null 2>&1 \
      || echo "אזהרה: התקנת miniflare/fake-indexeddb נכשלה — tests/server.mjs ו-tests/sync.mjs לא ירוצו"
  fi
fi
