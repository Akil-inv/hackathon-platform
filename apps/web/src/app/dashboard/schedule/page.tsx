'use client';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@/lib/use-graphql';
import { useAuthStore } from '@/lib/auth-store';
import { createClient } from '@/lib/graphql-client';
import {
  EVENTS_QUERY, TEAMS_QUERY, JUDGES_QUERY, ROOMS_QUERY, TIMESLOTS_QUERY,
  CONFLICTS_QUERY, SESSIONS_QUERY, SAVE_SESSIONS_MUTATION, GENERATE_SCHEDULE_MUTATION
} from '@/lib/queries';
import StatusBadge from '@/components/status-badge';

interface PlannerCard {
  teamId: string;
  teamName: string;
  projectName: string;
  trackName: string;
  organisation: string;
  techStack: string;
  roomId: string | null;
  date: string | null;
  slotId: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  judgeIds: string[];
}

export default function ScheduleBuilderPage() {
  const { data: evData } = useQuery<any>(EVENTS_QUERY);
  const event = evData?.events?.[0];
  const eventId = event?.id;

  const { data: teamData } = useQuery<any>(TEAMS_QUERY, eventId ? { eventId } : undefined);
  const { data: judgeData } = useQuery<any>(JUDGES_QUERY, eventId ? { eventId } : undefined);
  const { data: roomData } = useQuery<any>(ROOMS_QUERY, eventId ? { eventId } : undefined);
  const { data: slotData } = useQuery<any>(TIMESLOTS_QUERY, eventId ? { eventId } : undefined);
  const { data: conflictData } = useQuery<any>(CONFLICTS_QUERY, eventId ? { eventId } : undefined);
  const { data: sessionData } = useQuery<any>(SESSIONS_QUERY, eventId ? { eventId } : undefined);
  const token = useAuthStore((s) => s.token);

  const allTeams = teamData?.teams || [];
  const judges = judgeData?.judges || [];
  const rooms = roomData?.rooms || [];
  const allSlots = (slotData?.timeSlots || []).filter((s: any) => s.slotType === 'JUDGING');
  const conflicts = conflictData?.conflicts || [];
  const existingSessions = sessionData?.sessions || [];

  // State
  const [plannerCards, setPlannerCards] = useState<PlannerCard[]>([]);
  const [scheduledCards, setScheduledCards] = useState<any[]>([]);
  const [groupBy, setGroupBy] = useState<'track' | 'organisation' | 'techStack'>('track');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');

  // Track which teams are already scheduled or in planner
  const plannerTeamIds = new Set(plannerCards.map(c => c.teamId));
  const scheduledTeamIds = new Set(existingSessions.map((s: any) => s.teamId));
  const unscheduledTeams = allTeams.filter((t: any) => !plannerTeamIds.has(t.id) && !scheduledTeamIds.has(t.id));

  // Track judge workload (existing sessions + planner assignments)
  const judgeWorkload: Record<string, number> = {};
  existingSessions.forEach((s: any) => s.judges?.forEach((j: any) => { judgeWorkload[j.judgeId] = (judgeWorkload[j.judgeId] || 0) + 1; }));
  plannerCards.forEach(c => c.judgeIds.forEach(jId => { judgeWorkload[jId] = (judgeWorkload[jId] || 0) + 1; }));

  // Track used slots (room+slot combos)
  const usedSlots = new Set<string>();
  existingSessions.forEach((s: any) => usedSlots.add(`${s.roomId}:${s.timeSlotId}`));
  plannerCards.forEach(c => { if (c.roomId && c.slotId) usedSlots.add(`${c.roomId}:${c.slotId}`); });

  // Judge conflict lookup
  const conflictSet = new Set(conflicts.filter((c: any) => c.status === 'ACTIVE').map((c: any) => `${c.judgeId}:${c.teamId}`));
  const hasConflict = (judgeId: string, teamId: string) => conflictSet.has(`${judgeId}:${teamId}`);

  // Judge busy in slot
  const judgeBusyInSlot = (judgeId: string, slotId: string, excludeTeamId?: string) => {
    for (const s of existingSessions) {
      if (s.timeSlotId === slotId && s.teamId !== excludeTeamId && s.judges?.some((j: any) => j.judgeId === judgeId)) return true;
    }
    for (const c of plannerCards) {
      if (c.slotId === slotId && c.teamId !== excludeTeamId && c.judgeIds.includes(judgeId)) return true;
    }
    return false;
  };

  // Group teams
  const groupTeams = (teams: any[]) => {
    const groups: Record<string, any[]> = {};
    teams.forEach(t => {
      const key = t[groupBy] || t.trackName || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  };

  // Available slots for a room+date
  const getAvailableSlots = (roomId: string, date: string, excludeTeamId?: string) => {
    return allSlots.filter((s: any) => {
      const slotDate = new Date(s.date).toISOString().split('T')[0];
      if (slotDate !== date) return false;
      const key = `${roomId}:${s.id}`;
      if (usedSlots.has(key)) {
        const isOwnSlot = plannerCards.some(c => c.teamId === excludeTeamId && c.roomId === roomId && c.slotId === s.id);
        return isOwnSlot;
      }
      return true;
    });
  };

  // Get unique dates
  const dates = [...new Set(allSlots.map((s: any) => new Date(s.date).toISOString().split('T')[0]))].sort();

  // Add team to planner
  const addToPlanner = (team: any) => {
    setPlannerCards(prev => [...prev, {
      teamId: team.id, teamName: team.name, projectName: team.projectName,
      trackName: team.trackName || '', organisation: team.organisation || '',
      techStack: team.techStack || '',
      roomId: null, date: null, slotId: null, slotStart: null, slotEnd: null, judgeIds: [],
    }]);
  };

  // Remove from planner
  const removeFromPlanner = (teamId: string) => {
    setPlannerCards(prev => prev.filter(c => c.teamId !== teamId));
  };

  // Update planner card
  const updateCard = (teamId: string, updates: Partial<PlannerCard>) => {
    setPlannerCards(prev => prev.map(c => c.teamId === teamId ? { ...c, ...updates } : c));
  };

  // Add judge to card
  const addJudge = (teamId: string, judgeId: string) => {
    setPlannerCards(prev => prev.map(c => {
      if (c.teamId !== teamId) return c;
      if (c.judgeIds.includes(judgeId)) return c;
      return { ...c, judgeIds: [...c.judgeIds, judgeId] };
    }));
  };

  // Remove judge from card
  const removeJudge = (teamId: string, judgeId: string) => {
    setPlannerCards(prev => prev.map(c => {
      if (c.teamId !== teamId) return c;
      return { ...c, judgeIds: c.judgeIds.filter(id => id !== judgeId) };
    }));
  };

  // Check if card is complete
  const isCardComplete = (card: PlannerCard) => {
    return card.roomId && card.date && card.slotId && card.judgeIds.length >= (event?.minJudgesPerTeam || 3);
  };

  // Confirm single card
  const confirmCard = async (card: PlannerCard) => {
    if (!isCardComplete(card) || !eventId) return;
    setSaving(true);
    try {
      const client = createClient(token);
      await client.mutation(SAVE_SESSIONS_MUTATION, {
        inputs: [{ eventId, teamId: card.teamId, roomId: card.roomId, timeSlotId: card.slotId, judgeIds: card.judgeIds }]
      }).toPromise();
      removeFromPlanner(card.teamId);
      setScheduledCards(prev => [...prev, card]);
      setMessage(`${card.teamName} scheduled successfully`);
      setTimeout(() => setMessage(''), 3000);
    } catch (e) { setMessage('Error saving session'); }
    setSaving(false);
  };

  // Auto-generate
  const autoGenerate = async () => {
    if (!eventId) return;
    setGenerating(true);
    try {
      const client = createClient(token);
      const res = await client.mutation(GENERATE_SCHEDULE_MUTATION, {
        input: { eventId, minJudgesPerTeam: event?.minJudgesPerTeam || 3, maxJudgesPerTeam: event?.maxJudgesPerTeam || 5 }
      }).toPromise();

      console.log('Generate response:', JSON.stringify(res, null, 2));

      if (res.error) {
        setMessage('API Error: ' + res.error.message);
        setGenerating(false);
        return;
      }

      const result = res.data?.generateSchedule;
      if (result?.success) {
        // Add generated sessions to planner
        const cards: PlannerCard[] = result.sessions.map((s: any) => ({
          teamId: s.teamId, teamName: s.teamName, projectName: '', trackName: '',
          organisation: '', techStack: '',
          roomId: s.roomId, date: s.slotDate,
          slotId: s.slotId, slotStart: s.slotStart, slotEnd: s.slotEnd,
          judgeIds: s.judgeIds,
        }));
        cards.sort((a: PlannerCard, b: PlannerCard) => {
          if (a.date !== b.date) return (a.date || "").localeCompare(b.date || "");
          return (a.slotStart || "").localeCompare(b.slotStart || "");
        });
        setPlannerCards(cards);
        setMessage(`Generated ${cards.length} sessions (Quality: ${result.qualityScore}, Time: ${result.solveTimeSeconds}s)`);
      } else {
        if (res.error) { setMessage('Error: ' + res.error.message); } else { setMessage('Schedule generation failed: ' + (result?.warnings?.join(', ') || 'No sessions returned')); }
      }
    } catch (e: any) { setMessage('Error: ' + e.message); }
    setGenerating(false);
  };

  // Confirm all complete cards
  const confirmAll = async () => {
    const complete = plannerCards.filter(isCardComplete);
    if (complete.length === 0 || !eventId) return;
    setSaving(true);
    try {
      const client = createClient(token);
      await client.mutation(SAVE_SESSIONS_MUTATION, {
        inputs: complete.map(c => ({ eventId, teamId: c.teamId, roomId: c.roomId!, timeSlotId: c.slotId!, judgeIds: c.judgeIds }))
      }).toPromise();
      setPlannerCards(prev => prev.filter(c => !isCardComplete(c)));
      setMessage(`${complete.length} sessions saved successfully`);
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) { setMessage('Error saving sessions'); }
    setSaving(false);
  };

  const completePlannerCount = plannerCards.filter(isCardComplete).length;
  const totalScheduled = existingSessions.length;
  const totalTeams = allTeams.length;
  const isEventLocked = event?.status === 'ACTIVE' || event?.status === 'COMPLETED';

  // Reset all sessions and planner
  const resetSchedule = async () => {
    if (!eventId || !token) return;
    if (!confirm('This will clear all sessions so you can regenerate from scratch.\n\nThis is only available before event day.\n\nAre you sure?')) return;
    setSaving(true);
    try {
      const res = await fetch(`http://localhost:4000/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: `mutation { resetSchedule(eventId: "${eventId}") }` }),
      });
      const d = await res.json();
      if (d.errors) {
        setMessage('Error: ' + (d.errors[0]?.message || 'Reset failed').split('] ').pop());
      } else {
        setPlannerCards([]);
        setMessage('Schedule cleared. You can now regenerate.');
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e: any) { setMessage('Error: ' + e.message); }
    setSaving(false);
  };

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Schedule Builder</h1>
          <p className="text-sm text-slate-400 mt-0.5">Drag teams and judges to build the schedule</p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <div className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-xs text-accent animate-in">
              {message}
            </div>
          )}
          {isEventLocked && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              🔒 Event is {event?.status} — schedule changes only via Command Centre
            </div>
          )}
          {!isEventLocked && totalScheduled > 0 && (
            <button onClick={resetSchedule} disabled={saving}
              className="px-4 py-2 bg-dark-700 hover:bg-red-900/30 text-slate-400 hover:text-red-400 text-xs font-medium rounded-lg border border-dark-500 hover:border-red-500/30 transition-all disabled:opacity-50">
              ↺ Reset Schedule
            </button>
          )}
          <button onClick={autoGenerate} disabled={generating || unscheduledTeams.length === 0 || isEventLocked}
            className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white text-xs font-medium rounded-lg border border-dark-500 transition-all disabled:opacity-50">
            {generating ? '⟳ Generating...' : '⚡ Auto-Generate'}
          </button>
          <button onClick={confirmAll} disabled={saving || completePlannerCount === 0 || isEventLocked}
            className="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-accent/20">
            ✓ Confirm {completePlannerCount > 0 ? `(${completePlannerCount})` : 'All'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-4 mb-4 flex-shrink-0">
        <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-accent to-success rounded-full transition-all duration-500"
            style={{ width: `${totalTeams > 0 ? ((totalScheduled + completePlannerCount) / totalTeams) * 100 : 0}%` }} />
        </div>
        <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
          {totalScheduled + completePlannerCount} / {totalTeams} scheduled
        </span>
      </div>

      {/* Judge Pool */}
      <div className="flex-shrink-0 mb-4 rounded-xl border border-dark-600 bg-dark-800/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Judge Pool</span>
          <span className="text-[10px] text-slate-500">{judges.length} judges</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {judges.map((j: any) => {
            const load = judgeWorkload[j.id] || 0;
            const atMax = load >= j.maxSessions;
            return (
              <div key={j.id} draggable={!atMax}
                onDragStart={(e) => { e.dataTransfer.setData('judgeId', j.id); e.dataTransfer.setData('judgeName', j.name); }}
                className={`flex-shrink-0 rounded-lg border px-3 py-2 cursor-grab active:cursor-grabbing transition-all ${
                  atMax ? 'border-dark-600 bg-dark-700/30 opacity-40 cursor-not-allowed'
                    : 'border-dark-500 bg-dark-700 hover:border-accent/40 hover:bg-dark-600'
                }`}>
                <p className="text-xs font-medium text-white whitespace-nowrap">{j.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={j.judgeType} />
                  <span className="text-[10px] text-slate-400 font-mono">{load}/{j.maxSessions}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">

        {/* LEFT: Unscheduled teams */}
        <div className="w-56 flex-shrink-0 flex flex-col rounded-xl border border-dark-600 bg-dark-800/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-dark-600 bg-dark-700/30 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">{unscheduledTeams.length} Remaining</span>
            </div>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}
              className="mt-2 w-full bg-dark-900/60 border border-dark-600 rounded text-[10px] text-slate-300 px-2 py-1 outline-none">
              <option value="track">Group by Track</option>
              <option value="organisation">Group by Organisation</option>
              <option value="techStack">Group by Tech Stack</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {Object.entries(groupTeams(unscheduledTeams)).map(([group, teams]) => (
              <div key={group}>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-2 mb-1">{group}</p>
                <div className="space-y-1">
                  {(teams as any[]).map((t: any) => (
                    <div key={t.id}
                      onClick={() => addToPlanner(t)}
                      className="rounded-lg border border-dark-600 bg-dark-700/50 p-2.5 cursor-pointer hover:border-accent/40 hover:bg-dark-700 transition-all group">
                      <p className="text-xs font-medium text-white group-hover:text-accent transition-colors">{t.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">{t.projectName}</p>
                      {t.organisation && <p className="text-[10px] text-slate-600 mt-0.5">{t.organisation}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {unscheduledTeams.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500">All teams assigned</div>
            )}
          </div>
        </div>

        {/* CENTER: Planner */}
        <div className="flex-1 flex flex-col rounded-xl border border-dark-600 bg-dark-800/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-dark-600 bg-dark-700/30 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Planner</span>
              <span className="text-[10px] text-slate-500">
                {plannerCards.length} cards · {completePlannerCount} ready
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {plannerCards.map((card) => {
              const complete = isCardComplete(card);
              const availSlots = card.roomId && card.date ? getAvailableSlots(card.roomId, card.date, card.teamId) : [];

              return (
                <div key={card.teamId}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const judgeId = e.dataTransfer.getData('judgeId');
                    if (judgeId) {
                      if (hasConflict(judgeId, card.teamId)) {
                        setMessage('⚠ Conflict: this judge cannot evaluate this team');
                        return;
                      }
                      if (card.slotId && judgeBusyInSlot(judgeId, card.slotId, card.teamId)) {
                        setMessage('⚠ Judge is busy in this time slot');
                        return;
                      }
                      addJudge(card.teamId, judgeId);
                    }
                  }}
                  className={`rounded-xl border-2 p-4 transition-all ${
                    complete ? 'border-success/40 bg-success/5' : 'border-dark-500 bg-dark-800/60'
                  }`}>
                  {/* Team info + remove button */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{card.teamName}</p>
                      <p className="text-xs text-slate-400">{card.projectName}</p>
                      <div className="flex gap-2 mt-1">
                        {card.trackName && <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">{card.trackName}</span>}
                        {card.organisation && <span className="text-[10px] bg-dark-600 text-slate-400 px-1.5 py-0.5 rounded">{card.organisation}</span>}
                        {card.techStack && <span className="text-[10px] bg-dark-600 text-slate-400 px-1.5 py-0.5 rounded">{card.techStack}</span>}
                      </div>
                    </div>
                    <button onClick={() => removeFromPlanner(card.teamId)} className="text-slate-500 hover:text-error text-xs">✕</button>
                  </div>

                  {/* Room, Date, Slot selectors */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <select value={card.roomId || ''} onChange={(e) => updateCard(card.teamId, { roomId: e.target.value || null, slotId: null, slotStart: null, slotEnd: null })}
                      className="bg-dark-900/80 border border-dark-500 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent">
                      <option value="">Room</option>
                      {rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <select value={card.date || ''} onChange={(e) => updateCard(card.teamId, { date: e.target.value || null, slotId: null, slotStart: null, slotEnd: null })}
                      className="bg-dark-900/80 border border-dark-500 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent">
                      <option value="">Date</option>
                      {dates.map(d => <option key={d} value={d}>{new Date(d + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</option>)}
                    </select>
                    <select value={card.slotId || ''} onChange={(e) => {
                      const slot = allSlots.find((s: any) => s.id === e.target.value);
                      updateCard(card.teamId, { slotId: e.target.value || null, slotStart: slot?.startTime || null, slotEnd: slot?.endTime || null });
                    }}
                      className="bg-dark-900/80 border border-dark-500 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent"
                      disabled={!card.roomId || !card.date}>
                      <option value="">Time</option>
                      {availSlots.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Judges zone */}
                  <div className="rounded-lg border border-dashed border-dark-500 p-2.5 min-h-[48px] bg-dark-900/30">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {card.judgeIds.map(jId => {
                        const judge = judges.find((j: any) => j.id === jId);
                        const conflict = hasConflict(jId, card.teamId);
                        return (
                          <span key={jId} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${
                            conflict ? 'bg-error/20 text-error border border-error/30' : 'bg-dark-600 text-slate-200 border border-dark-500'
                          }`}>
                            {judge?.name || jId.slice(0, 8)}
                            <button onClick={() => removeJudge(card.teamId, jId)} className="hover:text-error ml-0.5">✕</button>
                          </span>
                        );
                      })}
                      {card.judgeIds.length < (event?.maxJudgesPerTeam || 5) && (
                        <span className="text-[10px] text-slate-500 italic">
                          {card.judgeIds.length < (event?.minJudgesPerTeam || 3)
                            ? `Drop ${(event?.minJudgesPerTeam || 3) - card.judgeIds.length} more judge(s)`
                            : 'Drop to add more'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card footer */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex gap-1.5">
                      {!card.roomId && <span className="text-[10px] text-warning">⚠ Room</span>}
                      {!card.date && <span className="text-[10px] text-warning">⚠ Date</span>}
                      {!card.slotId && <span className="text-[10px] text-warning">⚠ Time</span>}
                      {card.judgeIds.length < (event?.minJudgesPerTeam || 3) && <span className="text-[10px] text-warning">⚠ Judges</span>}
                    </div>
                    <button onClick={() => confirmCard(card)} disabled={!complete || saving}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                        complete
                          ? 'bg-success hover:bg-success/90 text-white shadow-lg shadow-success/20'
                          : 'bg-dark-600 text-slate-500 cursor-not-allowed'
                      }`}>
                      {complete ? '✓ Confirm' : 'Incomplete'}
                    </button>
                  </div>
                </div>
              );
            })}

            {plannerCards.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-slate-500 text-sm">Click a team on the left to start planning</p>
                <p className="text-slate-600 text-xs mt-2">or use ⚡ Auto-Generate for AI scheduling</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Scheduled */}
        <div className="w-56 flex-shrink-0 flex flex-col rounded-xl border border-dark-600 bg-dark-800/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-dark-600 bg-dark-700/30 flex-shrink-0">
            <span className="text-xs font-semibold text-white">{totalScheduled} Scheduled</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {existingSessions.map((s: any) => (
              <div key={s.id} className="rounded-lg border border-success/20 bg-success/5 p-2.5">
                <p className="text-xs font-medium text-white">{s.teamName}</p>
                <div className="mt-1 space-y-0.5">
                  <p className="text-[10px] text-slate-400">{s.roomName}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {s.scheduledStart ? new Date(s.scheduledStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {s.judges?.map((j: any) => j.judgeName).join(', ')}
                  </p>
                </div>
                <div className="mt-1.5">
                  <StatusBadge status={s.stage} />
                </div>
              </div>
            ))}
            {totalScheduled === 0 && (
              <div className="py-8 text-center text-xs text-slate-500">No sessions yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
