---
name: repo-dev-server-and-id-date-stamp
description: Aesthetic clinic repo — test against the user's dev server on port 3000 (never start a second one), and human-readable IDs use a NO-dash date stamp (PT-20260923-0001) unlike API dates (2026-09-23)
metadata:
  type: project
---

Two hard-won gotchas in the "aesthetic clinic" Next.js + Neon Postgres repo:

1. **The user keeps their own `next dev` running on port 3000** (same project dir, shared `.next`). Never start a second dev server for this repo — two dev servers sharing one `.next` cache corrupt each other's route resolution (symptoms: `POST /api/auth/signup 404`, `PageNotFoundError: Cannot find module for page: /api/.../[id]/route`). For live API tests, run against `http://localhost:3000/api` and leave the user's server alone; do not delete `.next` while their server (often a ~1GB node.exe on :3000) is alive. Test scripts accept `TEST_PORT` for this.

2. **Two different date formats coexist**: human-readable IDs use a NO-dash stamp — `PT-20260923-0001`, `APT-20260923-5001` — while API payloads/values use dashed ISO dates (`2026-09-23`). A `LIKE 'PT-2026-09-23-%'` pattern silently matches nothing and returns `max = 0`, which once made a test's sequence "restore" wrongly rewind `patient_id_sequence`/`appointment_id_sequence` below existing IDs. When matching ID suffixes, build the stamp as `YYYYMMDD`; only use dashed dates for `appointment_date` comparisons.

Also: Neon is reached via the `-pooler` host, so `inet_server_addr()` reports `::1`/`127.0.0.1` (the pooler's localhost hop) — that does NOT mean the query hit a local PostgreSQL, even though this machine also runs a Docker Postgres on :5432.
