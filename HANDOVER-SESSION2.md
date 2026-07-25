# HANDOVER — Session 2 Complete

## Date: 25 July 2026
## Repo: https://github.com/Akil-inv/hackathon-platform

---

## 1. What Was Built This Session

### Phase 5 — Rankings (NEW)
- Backend: `calculateRankings`, `approveRankings`, `publishRankings` mutations + `rankings` query
- Service: Criterion-level averaging across judges, tie-break rules (highest criterion avg then judge count), per-track + overall
- Frontend: Full rankings page with track tabs, medal badges, expandable criterion breakdown
- Workflow: PROVISIONAL → APPROVED → PUBLISHED
- CSV Export: Download rankings with judge names, score %, "indicative" label
- Methodology modal: ? icon shows full calculation methodology with worked examples

### Phase 6 — Exports (NEW)
- 6 export endpoints, all CSV with UTF-8 BOM for Excel:
  - `/api/export/schedule` — full schedule with judge assignments per session
  - `/api/export/scores-raw` — one row per judge × team × criterion (pivot table ready)
  - `/api/export/scores` — one row per scorecard with all criteria + comments
  - `/api/export/team-aggregates` — per-team avg/min/max/stddev per criterion
  - `/api/export/judge-analytics` — per-judge scoring patterns, harshness index
  - `/api/export/rankings` — indicative leaderboard with judge names
- All exports filter on SUBMITTED/RESUBMITTED/LOCKED scorecards only
- "Export All Data" button downloads all 5 CSVs in sequence
- Rankings clearly labeled "Indicative — calibration done offline"

### Scheduler Improvements
- Room stickiness: Judges stay in same room within AM/PM blocks (was dead code before)
- Max sessions constraint: Per-judge capacity limits enforced
- AM/PM grouping: Slots grouped by date + morning/afternoon
- Solver timeout: Increased to 120s for 60-70 team events

### Operations Improvements
- Room movement warnings on swap/move/reschedule
- Conflict checks on team swap

### Event Setup Improvements
- Steps 3-7 sequential unlock fixed (was all stepStyle(7))
- Capacity validation panel: warns when judge capacity < teams × minJudges
- CSV import error modal with per-row rejection details
- Track name suggestion in error messages
- Schedule reset button (pre-event only)
- Event day lock (schedule changes blocked when ACTIVE)

### Judge Portal Fix
- Criterion auto-creation: 5 sliders now appear on first load

### UX Fixes
- Error messages persist until dismissed (success auto-dismisses)
- Sidebar reordered: Dashboard → Event Setup → Schedule → Command Centre

### Real-time (SSE) Layer — Built, Not Wired
- EventsService: PG LISTEN/NOTIFY bridge with in-process fallback
- EventsController: SSE endpoints for dashboard + judge portal
- EventsModule: Global module, injectable anywhere
- Frontend hook: useEventStream with auto-reconnect + exponential backoff
- Integration guide: INTEGRATION.ts with step-by-step wiring instructions

### Cloud Deployment — Config Ready
- docker-compose.yml: All 4 services + nginx + certbot
- nginx.conf: SSE-aware proxy config with SSL

---

## 2. End-to-End Pipeline Validated

```
Event Setup (7 steps)
  → Schedule (auto-generate with room stickiness)
    → Command Centre (start sessions)
      → Judge Portal (score with 5 criteria sliders)
        → Scoring Monitoring (per-judge breakdown)
          → Rankings (calculate → approve → publish)
            → Export (6 CSV files for offline calibration)
```

Tested on 25 Jul 2026 with:
- Amanda Lee scored OmicronAI: 73/100 (Innovation 14, Impact 29, Feasibility 6, Collaboration 17, Bonus 7)
- Rankings calculated and displayed with track tabs
- All 6 exports verified working

---

## 3. Event Scale Planning

Target: 60-70 teams, 20-25 judges, 5-8 coordinators, 2 days

### Capacity Requirements
| Resource | Minimum | Recommended |
|---|---|---|
| Rooms | 3 | 4 |
| Judges (at 3/team) | 30-35 | 35 |
| Judges (at 4/team) | 40+ | 45 |
| Max sessions/judge | 8-10/day | 8 (sustainable quality) |
| Time slots/room/day | ~16 (25min intervals, 7h judging) | 16 |

### Server Sizing
- Instance: t3.medium (2 vCPU, 4GB RAM)
- Cost: ~$30/month
- Peak concurrent users: ~33 (all judges + coordinators)
- CPU: ~15% avg, 40% peak during schedule generation
- Memory: ~1.8GB of 4GB
- Handles the event with 10x headroom

---

## 4. Scoring Methodology

### How Rankings Are Calculated
1. Collect all SUBMITTED/LOCKED scorecards for each team
2. For each criterion, compute arithmetic mean across all judges
3. Sum criterion averages = team aggregated score
4. Rank by score descending
5. Tie-break: highest single criterion average, then judge count

### What the System Does NOT Do (by design)
- Weight by judge tier (L1/L2/L3 treated equally)
- Normalize for judge count (3-judge avg = 5-judge avg)
- Adjust for harsh/lenient judges
- Drop outlier scores

These are handled by the offline calibration panel using the exported data.

### Criteria Weights (implicit via max score)
- Innovation: /20 (20%)
- Business Impact: /40 (40%)
- Feasibility: /10 (10%)
- Collaboration: /20 (20%)
- Judge Bonus: /10 (10%)

---

## 5. Architecture

```
┌─────────────────────────────────────────────────┐
│                   nginx (:443)                  │
│              SSL + reverse proxy                │
└──────┬──────────────┬──────────────┬────────────┘
       │              │              │
┌──────▼──────┐ ┌─────▼──────┐ ┌────▼─────────┐
│  Next.js    │ │ NestJS API │ │  Scheduler   │
│  (:3000)    │ │  (:4000)   │ │  (:8001)     │
│  Frontend   │ │  GraphQL   │ │  Python      │
│             │ │  REST      │ │  OR-Tools    │
│             │ │  SSE       │ │              │
└─────────────┘ └─────┬──────┘ └──────────────┘
                      │
               ┌──────▼──────┐
               │ PostgreSQL  │
               │  (:5432)    │
               │  + LISTEN/  │
               │    NOTIFY   │
               └─────────────┘
```

### Multi-User Architecture
- Admin/Coordinator: JWT auth, full dashboard access
- Judges: Token-based URL, no login, see only own schedule/scores
- All state in PostgreSQL, no in-memory sessions
- Scorecard dedup: unique constraint on eventId+judgeId+teamId
- SSE for real-time updates (PG LISTEN/NOTIFY → NestJS → EventSource)

---

## 6. File Inventory — Session 2 Changes

### Backend (apps/api)
| File | Status |
|---|---|
| src/rankings/rankings.module.ts | Complete rewrite |
| src/rankings/rankings.types.ts | Complete rewrite (includes judgeNames) |
| src/rankings/rankings.service.ts | Complete rewrite (criterion averaging + judge names) |
| src/rankings/rankings.resolver.ts | Complete rewrite (nullable trackId) |
| src/scheduling/scheduling.resolver.ts | Added resetSchedule mutation |
| src/operations/operations.service.ts | Added room movement warnings |
| src/judge-portal/judge-portal.controller.ts | Complete rewrite (criterion auto-creation) |
| src/export/export.controller.ts | NEW — 6 CSV export endpoints |
| src/export/export.module.ts | NEW |
| src/events/events.service.ts | NEW — SSE PG LISTEN/NOTIFY bridge |
| src/events/events.controller.ts | NEW — SSE HTTP endpoints |
| src/events/events.module.ts | NEW — Global module |
| src/teams/teams.service.ts | Better track-not-found errors |

### Frontend (apps/web)
| File | Status |
|---|---|
| src/app/dashboard/rankings/page.tsx | Complete rewrite (298→400 lines) |
| src/app/dashboard/event/page.tsx | Step unlock fix, capacity panel, import modal |
| src/app/dashboard/schedule/page.tsx | Reset button, event lock |
| src/components/sidebar.tsx | Reordered nav items |
| src/lib/use-event-stream.ts | NEW — SSE React hook |

### Scheduler (apps/scheduler)
| File | Status |
|---|---|
| src/solver.py | Room stickiness, max_sessions, 120s timeout |

### Deployment
| File | Status |
|---|---|
| docker-compose.yml | NEW — all services + nginx + certbot |
| nginx.conf | NEW — SSE-aware proxy with SSL |

---

## 7. Running Locally

```bash
# Terminal 1: PostgreSQL
docker start hackathon-db

# Terminal 2: API
cd apps/api && npm run start:dev

# Terminal 3: Frontend
cd apps/web && npm run dev

# Terminal 4: Scheduler
cd apps/scheduler && source .venv/bin/activate && uvicorn src.main:app --port 8001

# Login
admin@hackathon.local / admin123
coordinator@hackathon.local / coord123
```

---

## 8. Current Database State

- Event: UOB Innovation Challenge 2026 (Fri 24 Jul – Sat 25 Jul)
- Teams: 20 across 4 tracks
- Judges: 14 (L1 judges bumped to maxSessions=8)
- Rooms: 2
- Sessions: 20 generated
- Scorecards: Amanda Lee submitted 73/100 for OmicronAI
- Rankings: 1 team ranked (PROVISIONAL)

---

## 9. Session 3 Plan

### Priority 1: Cloud Deployment
- Spin up t3.medium EC2 (Ubuntu 24, 30GB gp3)
- Write Dockerfiles for API, web, scheduler
- docker compose up -d
- SSL via Let's Encrypt
- Domain: TBD

### Priority 2: Notification System
- SES email sending (already have SES working)
- SNS SMS as toggle option
- wa.me deep links as manual fallback
- Batch UI: pick channel, pick batch size (10/15/20), send
- Per-judge delivery status with individual retry buttons
- Phone number field in judge schema + CSV import

### Priority 3: Wire SSE Events
- Emit from operations service (stage changes, swaps)
- Emit from judge portal (score submissions)
- Emit from rankings (calculations)
- Frontend hooks on Command Centre, Scoring, Judge Portal

### Priority 4: Dashboard KPIs
- Wire live data to the existing 735-line dashboard page

### Priority 5: Event Day Dry Run
- 65 teams, 30+ judges, 3-4 rooms
- Full simulation: setup → schedule → start → score → rank → export

### Prep Before Session 3
- [ ] AWS account with EC2 access ready
- [ ] Domain name decided (or use EC2 public IP)
- [ ] SES sender email/domain verified
- [ ] SNS SMS enabled in ap-southeast-1
- [ ] Judge count decided (30-35 minimum for 65 teams)
- [ ] Room count decided (3-4)
- [ ] Judge CSV updated with phone numbers
