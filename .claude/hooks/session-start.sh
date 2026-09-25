#!/bin/bash
# Session start: declare the always-on skill. A skill loads only when invoked
# or when its description matches, so "always active" has to be stated here;
# SessionStart output goes into the session context.
set -euo pipefail

cat <<'ACTIVATE'
פעיל בסשן הזה: .claude/skills/token-efficient-workflow/SKILL.md — קרא אותו עכשיו
ועבוד לפיו לאורך כל הסשן, בלי קשר לסוג המשימה. תמצית: חיפוש ממוקד לפני קריאה,
קריאת טווחים ולא קבצים שלמים, עריכה כירורגית ולא כתיבה מחדש, ואפס מילות קישור.
גובר עליו רק CLAUDE.md — ובפרט: סנכרון מול origin/main לפני כל עבודה, קידום גרסה, ו-tests/smoke.mjs לפני commit.
ACTIVATE
