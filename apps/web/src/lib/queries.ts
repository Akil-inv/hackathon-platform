export const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { accessToken user { id email role } }
  }
`;

export const ME_QUERY = `query { me { id email role } }`;
export const EVENTS_QUERY = `query { events { id name description location timezone startDate endDate status sessionDurationMinutes minJudgesPerTeam maxJudgesPerTeam } }`;

export const TEAMS_QUERY = `
  query Teams($eventId: String!) {
    teams(eventId: $eventId) { id name projectName trackName teamLeadName teamLeadEmail status organisation techStack createdAt }
  }
`;

export const JUDGES_QUERY = `
  query Judges($eventId: String!) {
    judges(eventId: $eventId) { id name email organisation judgeType judgeTier maxSessions status availabilityCount conflictCount
      availability { date startTime endTime }
      expertise { trackId trackName expertiseLevel }
    }
  }
`;

export const TRACKS_QUERY = `query Tracks($eventId: String!) { tracks(eventId: $eventId) { id name description displayOrder status teamCount } }`;
export const ROOMS_QUERY = `query Rooms($eventId: String!) { rooms(eventId: $eventId) { id name capacity locationDescription isVirtual hasVideoConferencing status } }`;
export const TIMESLOTS_QUERY = `query TimeSlots($eventId: String!) { timeSlots(eventId: $eventId) { id date startTime endTime slotType } }`;
export const CONFLICTS_QUERY = `query Conflicts($eventId: String!) { conflicts(eventId: $eventId) { id judgeId judgeName teamId teamName reason source status createdAt } }`;

export const SCORING_TEMPLATES_QUERY = `
  query ScoringTemplates($eventId: String!) {
    scoringTemplates(eventId: $eventId) {
      id name description maxTotal status criteriaTotal
      criteria { id name maxScore weight displayOrder guidanceText requiresComment scoringAnchors }
    }
  }
`;

export const AUDIT_LOGS_QUERY = `
  query AuditLogs($eventId: String!, $take: Float, $skip: Float) {
    auditLogsByEvent(eventId: $eventId, take: $take, skip: $skip) {
      id action entityType entityId oldValues newValues reason createdAt user { email }
    }
  }
`;

export const SESSIONS_QUERY = `
  query Sessions($eventId: String!) {
    sessions(eventId: $eventId) {
      id teamId teamName projectName trackName roomId roomName timeSlotId stage
      scheduledStart scheduledEnd
      judges { judgeId judgeName attended }
      scorecardsSubmitted scorecardsTotal
    }
  }
`;

export const SAVE_SESSIONS_MUTATION = `
  mutation SaveSessions($inputs: [SaveScheduleInput!]!) {
    saveScheduleSessions(inputs: $inputs) { id teamName roomName stage }
  }
`;

export const GENERATE_SCHEDULE_MUTATION = `
  mutation GenerateSchedule($input: GenerateScheduleInput!) {
    generateSchedule(input: $input) {
      success qualityScore solveTimeSeconds warnings
      sessions { teamId teamName roomId roomName slotId slotDate slotStart slotEnd judgeIds judgeNames }
      unscheduledTeams
    }
  }
`;

export const CALCULATE_RANKINGS = `
  mutation CalculateRankings($eventId: String!, $trackId: String) {
    calculateRankings(eventId: $eventId, trackId: $trackId) {
      teamsRanked teamsWithIncompleteScores status
      rankings { rankPosition teamName projectName trackName aggregatedScore judgeCount status
        criterionAverages { criterionName average maxScore }
      }
    }
  }
`;

export const RANKINGS_QUERY = `
  query Rankings($eventId: String!, $trackId: String) {
    rankings(eventId: $eventId, trackId: $trackId) {
      teamsRanked status trackName
      rankings { rankPosition teamName projectName trackName aggregatedScore judgeCount status }
    }
  }
`;

export const SCORECARDS_BY_EVENT_QUERY = `
  query ScorecardsEvent($eventId: String!) {
    scorecardsByEvent(eventId: $eventId) { id teamId teamName projectName judgeName status totalScore criterionScores { criterionId criterionName score maxScore comment } }
  }
`;

export const SCORECARDS_BY_JUDGE_QUERY = `
  query ScorecardsJudge($judgeId: String!, $eventId: String!) {
    scorecardsByJudge(judgeId: $judgeId, eventId: $eventId) {
      id sessionId judgeId judgeName teamId teamName projectName status totalScore submittedAt
      criterionScores { id criterionId criterionName maxScore guidanceText requiresComment score comment }
    }
  }
`;

export const SCORECARD_DETAIL_QUERY = `
  query Scorecard($id: String!) {
    scorecard(id: $id) {
      id sessionId judgeId judgeName teamId teamName projectName status totalScore
      overallStrengths areasForImprovement recommendation conflictConfirmed submittedAt reopenReason
      criterionScores { id criterionId criterionName maxScore guidanceText requiresComment score comment }
    }
  }
`;

export const SAVE_DRAFT_MUTATION = `
  mutation SaveDraft($input: SaveScorecardInput!) {
    saveScorecardDraft(input: $input) { id status totalScore }
  }
`;

export const SUBMIT_SCORECARD_MUTATION = `
  mutation Submit($input: SubmitScorecardInput!) {
    submitScorecard(input: $input) { id status totalScore submittedAt }
  }
`;

// --- Event context ------------------------------------------------------

// Requires UsersModule registered in app.module.ts.
// Until then EventSelector falls back to EVENTS_QUERY.
export const MY_EVENTS_QUERY = `query { myEvents { id name status role } }`;

// --- User management ----------------------------------------------------

export const USERS_QUERY = `query { users { id email name role } }`;

export const CREATE_USER_MUTATION = `
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) { id email name role }
  }
`;

export const ASSIGN_EVENT_ROLE_MUTATION = `
  mutation AssignEventRole($input: AssignEventRoleInput!) {
    assignEventRole(input: $input)
  }
`;

export const REMOVE_EVENT_ROLE_MUTATION = `
  mutation RemoveEventRole($userId: String!, $eventId: String!) {
    removeEventRole(userId: $userId, eventId: $eventId)
  }
`;

export const DELETE_USER_MUTATION = `
  mutation DeleteUser($userId: String!) {
    deleteUser(userId: $userId)
  }
`;

export const RESET_USER_PASSWORD_MUTATION = `
  mutation ResetUserPassword($userId: String!, $newPassword: String!) {
    resetUserPassword(userId: $userId, newPassword: $newPassword)
  }
`;

// --- Dashboard KPIs -----------------------------------------------------
// Deliberately lean: only the fields the KPI cards read, so the dashboard
// doesn't pull full session payloads on every poll.

export const DASHBOARD_SESSIONS_QUERY = `
  query DashboardSessions($eventId: String!) {
    sessions(eventId: $eventId) {
      id teamId teamName roomName stage scheduledStart scheduledEnd
      scorecardsSubmitted scorecardsTotal
    }
  }
`;

export const DASHBOARD_HEALTH_QUERY = `
  query DashboardHealth($eventId: String!) {
    sessionHealthCheck(eventId: $eventId) {
      sessionId teamName roomName stage isHealthy issues judgesAssigned judgesRequired
    }
  }
`;

export const EVENT_USERS_QUERY = `
  query EventUsers($eventId: String!) {
    eventUsers(eventId: $eventId) { userId email name globalRole role }
  }
`;
