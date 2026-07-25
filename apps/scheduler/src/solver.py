from ortools.sat.python import cp_model
import time
from .models import ScheduleRequest, ScheduleResponse, SessionAssignment


def generate_schedule(req: ScheduleRequest) -> ScheduleResponse:
    start_time = time.time()

    model = cp_model.CpModel()

    teams = req.teams
    judges = req.judges
    slots = req.slots
    rooms = req.rooms
    min_j = req.min_judges_per_team
    max_j = req.max_judges_per_team

    n_teams = len(teams)
    n_slots = len(slots)
    n_rooms = len(rooms)
    n_judges = len(judges)

    if n_teams == 0 or n_slots == 0 or n_rooms == 0 or n_judges == 0:
        return ScheduleResponse(
            success=False,
            warnings=["No teams, slots, rooms, or judges provided"],
            solve_time_seconds=time.time() - start_time,
        )

    # Index maps
    team_idx = {t.id: i for i, t in enumerate(teams)}
    slot_idx = {s.id: i for i, s in enumerate(slots)}
    room_idx = {r.id: i for i, r in enumerate(rooms)}
    judge_idx = {j.id: i for i, j in enumerate(judges)}

    # Judge availability as set of slot indices
    judge_avail = {}
    for j_i, j in enumerate(judges):
        if j.available_slot_ids:
            judge_avail[j_i] = {slot_idx[sid] for sid in j.available_slot_ids if sid in slot_idx}
        else:
            judge_avail[j_i] = set(range(n_slots))

    # Judge conflict sets
    judge_conflicts = {}
    for j_i, j in enumerate(judges):
        judge_conflicts[j_i] = {team_idx[tid] for tid in j.conflict_team_ids if tid in team_idx}

    # Group slots by half-day (AM/PM) for room stickiness
    # Slots are ordered by time; group by date + AM/PM
    slot_groups = {}  # group_key -> list of slot indices
    for s_i, s in enumerate(slots):
        hour = 12  # default
        try:
            if hasattr(s, 'start_time') and s.start_time:
                hour = int(s.start_time.split(':')[0].split('T')[-1])
        except (ValueError, IndexError):
            pass
        period = 'AM' if hour < 12 else 'PM'
        date = getattr(s, 'date', 'unknown')
        key = f"{date}_{period}"
        if key not in slot_groups:
            slot_groups[key] = []
        slot_groups[key].append(s_i)

    # ─── Decision Variables ───

    # x[t][s][r] = 1 if team t is scheduled in slot s, room r
    x = {}
    for t in range(n_teams):
        for s in range(n_slots):
            for r in range(n_rooms):
                x[t, s, r] = model.new_bool_var(f"x_t{t}_s{s}_r{r}")

    # y[j][t][s][r] = 1 if judge j assigned to team t in slot s, room r
    y = {}
    for j in range(n_judges):
        for t in range(n_teams):
            for s in range(n_slots):
                for r in range(n_rooms):
                    y[j, t, s, r] = model.new_bool_var(f"y_j{j}_t{t}_s{s}_r{r}")

    # ─── Hard Constraints ───

    # 1. Each team scheduled exactly once
    for t in range(n_teams):
        model.add(sum(x[t, s, r] for s in range(n_slots) for r in range(n_rooms)) == 1)

    # 2. Each room-slot has at most one team
    for s in range(n_slots):
        for r in range(n_rooms):
            model.add(sum(x[t, s, r] for t in range(n_teams)) <= 1)

    # 3. A judge can only be in one room per slot (no double-booking)
    for j in range(n_judges):
        for s in range(n_slots):
            model.add(sum(y[j, t, s, r] for t in range(n_teams) for r in range(n_rooms)) <= 1)

    # 4. Judge assigned only if team is in that slot-room
    for j in range(n_judges):
        for t in range(n_teams):
            for s in range(n_slots):
                for r in range(n_rooms):
                    model.add(y[j, t, s, r] <= x[t, s, r])

    # 5. Minimum judges per team
    for t in range(n_teams):
        model.add(
            sum(y[j, t, s, r] for j in range(n_judges) for s in range(n_slots) for r in range(n_rooms))
            >= min_j
        )

    # 6. Maximum judges per team
    for t in range(n_teams):
        model.add(
            sum(y[j, t, s, r] for j in range(n_judges) for s in range(n_slots) for r in range(n_rooms))
            <= max_j
        )

    # 7. Judge availability
    for j in range(n_judges):
        for s in range(n_slots):
            if s not in judge_avail[j]:
                for t in range(n_teams):
                    for r in range(n_rooms):
                        model.add(y[j, t, s, r] == 0)

    # 8. Conflict of interest
    for j in range(n_judges):
        for t in judge_conflicts.get(j, set()):
            for s in range(n_slots):
                for r in range(n_rooms):
                    model.add(y[j, t, s, r] == 0)

    # 9. Judge max sessions
    for j_i, j in enumerate(judges):
        max_sessions = getattr(j, 'max_sessions', None)
        if max_sessions and max_sessions > 0:
            model.add(
                sum(y[j_i, t, s, r] for t in range(n_teams) for s in range(n_slots) for r in range(n_rooms))
                <= max_sessions
            )

    # ─── Soft Objectives ───

    # A. Minimize workload imbalance
    judge_loads = []
    for j in range(n_judges):
        load = model.new_int_var(0, n_teams, f"load_j{j}")
        model.add(load == sum(y[j, t, s, r] for t in range(n_teams) for s in range(n_slots) for r in range(n_rooms)))
        judge_loads.append(load)

    max_load = model.new_int_var(0, n_teams, "max_load")
    min_load = model.new_int_var(0, n_teams, "min_load")
    model.add_max_equality(max_load, judge_loads)
    model.add_min_equality(min_load, judge_loads)
    load_diff = model.new_int_var(0, n_teams, "load_diff")
    model.add(load_diff == max_load - min_load)

    # B. Room stickiness: penalize judge changing rooms between consecutive slots
    #    within the same half-day block
    room_change_penalties = []
    for j in range(n_judges):
        for group_key, group_slots in slot_groups.items():
            sorted_slots = sorted(group_slots)
            for idx in range(len(sorted_slots) - 1):
                s1 = sorted_slots[idx]
                s2 = sorted_slots[idx + 1]
                for r in range(n_rooms):
                    # judge is in room r at s1 but NOT in room r at s2
                    in_r_s1 = model.new_bool_var(f"jr_{j}_{s1}_{r}")
                    in_r_s2 = model.new_bool_var(f"jr_{j}_{s2}_{r}")
                    model.add(in_r_s1 == sum(y[j, t, s1, r] for t in range(n_teams)))
                    model.add(in_r_s2 == sum(y[j, t, s2, r] for t in range(n_teams)))

                    # changed = was in room r at s1 but not at s2
                    changed = model.new_bool_var(f"chg_{j}_{s1}_{s2}_{r}")
                    # changed = 1 only if in_r_s1 = 1 AND in_r_s2 = 0
                    model.add(changed <= in_r_s1)
                    model.add(changed <= 1 - in_r_s2)
                    model.add(changed >= in_r_s1 + (1 - in_r_s2) - 1)
                    room_change_penalties.append(changed)

    # Objective: workload balance (weight 10) + room stickiness (weight 5 each change)
    total_room_changes = model.new_int_var(0, n_judges * n_slots * n_rooms, "total_room_changes")
    if room_change_penalties:
        model.add(total_room_changes == sum(room_change_penalties))
    else:
        model.add(total_room_changes == 0)

    model.minimize(load_diff * 10 + total_room_changes * 5)

    # ─── Solve ───
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120.0
    solver.parameters.num_workers = 4

    status = solver.solve(model)

    solve_time = time.time() - start_time

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return ScheduleResponse(
            success=False,
            warnings=["Solver could not find a feasible schedule. Check constraints."],
            solve_time_seconds=solve_time,
        )

    # ─── Extract Solution ───
    sessions = []
    scheduled_teams = set()

    for t in range(n_teams):
        for s in range(n_slots):
            for r in range(n_rooms):
                if solver.value(x[t, s, r]) == 1:
                    scheduled_teams.add(t)
                    assigned_judges = []
                    assigned_judge_names = []
                    for j in range(n_judges):
                        if solver.value(y[j, t, s, r]) == 1:
                            assigned_judges.append(judges[j].id)
                            assigned_judge_names.append(judges[j].name)

                    sessions.append(SessionAssignment(
                        team_id=teams[t].id,
                        team_name=teams[t].name,
                        room_id=rooms[r].id,
                        room_name=rooms[r].name,
                        slot_id=slots[s].id,
                        slot_date=slots[s].date,
                        slot_start=slots[s].start_time,
                        slot_end=slots[s].end_time,
                        judge_ids=assigned_judges,
                        judge_names=assigned_judge_names,
                    ))

    unscheduled = [teams[t].name for t in range(n_teams) if t not in scheduled_teams]

    # Quality score
    warnings = []
    if unscheduled:
        warnings.append(f"{len(unscheduled)} teams could not be scheduled")

    quality = 100.0
    if unscheduled:
        quality -= (len(unscheduled) / n_teams) * 50
    load_imbalance = solver.value(load_diff)
    if load_imbalance > 2:
        quality -= min(20, load_imbalance * 5)
        warnings.append(f"Judge workload imbalance: {load_imbalance} sessions difference")
    room_changes_val = solver.value(total_room_changes)
    if room_changes_val > 0:
        quality -= min(15, room_changes_val * 2)
        warnings.append(f"Judge room changes: {room_changes_val} (lower is better)")

    return ScheduleResponse(
        success=True,
        sessions=sessions,
        unscheduled_teams=unscheduled,
        warnings=warnings,
        quality_score=round(quality, 1),
        solve_time_seconds=round(solve_time, 2),
    )
