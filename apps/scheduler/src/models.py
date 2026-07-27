from pydantic import BaseModel
from typing import Optional

class TeamInput(BaseModel):
    id: str
    name: str
    track_id: Optional[str] = None

class JudgeInput(BaseModel):
    id: str
    name: str
    judge_type: str
    max_sessions: int = 10
    available_slot_ids: list[str] = []
    conflict_team_ids: list[str] = []
    expertise_track_ids: list[str] = []

class SlotInput(BaseModel):
    id: str
    date: str
    start_time: str
    end_time: str

class RoomInput(BaseModel):
    id: str
    name: str

class LockedSession(BaseModel):
    """
    A session that already exists and must not be moved.

    Manually placed sessions are not re-solved, but the solver still has to
    know about them: their room-slot is occupied, their judges are busy in
    that slot, and those judges have already used part of their session
    budget. Without this the solver produces a schedule that looks valid but
    double-books rooms and judges against work that already exists.
    """
    team_id: str
    room_id: str
    slot_id: str
    judge_ids: list[str] = []

class ScheduleRequest(BaseModel):
    event_id: str
    teams: list[TeamInput]
    judges: list[JudgeInput]
    slots: list[SlotInput]
    rooms: list[RoomInput]
    min_judges_per_team: int = 3
    max_judges_per_team: int = 5
    # Sessions that already exist and are being worked around. Teams in
    # `teams` are the ones still to schedule; these are not re-solved.
    locked_sessions: list[LockedSession] = []

class SessionAssignment(BaseModel):
    team_id: str
    team_name: str
    room_id: str
    room_name: str
    slot_id: str
    slot_date: str
    slot_start: str
    slot_end: str
    judge_ids: list[str]
    judge_names: list[str]

class ScheduleResponse(BaseModel):
    success: bool
    sessions: list[SessionAssignment] = []
    unscheduled_teams: list[str] = []
    warnings: list[str] = []
    quality_score: float = 0.0
    solve_time_seconds: float = 0.0

class ValidateRequest(BaseModel):
    sessions: list[SessionAssignment]

class ValidateResponse(BaseModel):
    valid: bool
    violations: list[str] = []
