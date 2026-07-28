'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import StatusBadge from '@/components/status-badge';
import DriftMetronome from '@/components/drift-metronome';

export default function JudgePortalPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const eventId = searchParams.get('event') || '';
  const [schedule, setSchedule] = useState<any>(null);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeScorecard, setActiveScorecard] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, { score: number | null; comment: string }>>({});
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const apiUrl = typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':4000') : '';

  const fetchData = async () => {
    if (!token || !eventId) return;
    try {
      const [schedRes, scRes] = await Promise.all([
        fetch(`${apiUrl}/api/judge-portal/${token}?event=${eventId}`),
        fetch(`${apiUrl}/api/judge-portal/${token}/scorecards?event=${eventId}`),
      ]);
      if (!schedRes.ok) throw new Error('Invalid link');
      const schedData = await schedRes.json();
      const scData = scRes.ok ? await scRes.json() : [];
      setSchedule(schedData);
      setScorecards(scData);
      setLastUpdated(new Date());
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [token, eventId]);
  useEffect(() => {
    if (!token || !eventId) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [token, eventId]);

  const openScorecard = (sc: any) => {
    setActiveScorecard(sc);
    const scoreMap: Record<string, { score: number | null; comment: string }> = {};
    sc.criterionScores?.forEach((cs: any) => {
      scoreMap[cs.criterionId] = { score: cs.score, comment: cs.comment || '' };
    });
    setScores(scoreMap);
    setStrengths(sc.overallStrengths || '');
    setImprovements(sc.areasForImprovement || '');
    setRecommendation(sc.recommendation || '');
    setMessage('');
  };

  const saveOrSubmit = async (submit: boolean) => {
    if (!activeScorecard) return;
    setSaving(true);
    try {
      const body = {
        scorecardId: activeScorecard.id,
        scores: Object.entries(scores)
          .filter(([_, s]) => s.score !== null)
          .map(([criterionId, s]) => ({ criterionId, score: s.score!, comment: s.comment || undefined })),
        overallStrengths: strengths || undefined,
        areasForImprovement: improvements || undefined,
        recommendation: recommendation || undefined,
        submit,
      };
      const res = await fetch(`${apiUrl}/api/judge-portal/${token}/score?event=${eventId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error || data.message?.startsWith('Error') || !res.ok) {
        setMessage(data.message || data.error || 'Error saving');
      } else {
        setMessage(submit ? 'Scorecard submitted!' : 'Draft saved');
        if (submit) {
          setActiveScorecard(null);
          fetchData();
        }
      }
    } catch (e: any) { setMessage('Error: ' + e.message); }
    setSaving(false);
  };

  if (loading) return (
    <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
      <p className="text-gray-400 text-lg">Loading your schedule...</p>
    </main>
  );
  if (error) return (
    <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
      <p className="text-red-400 text-lg font-semibold">Invalid Link</p>
    </main>
  );

  const judge = schedule?.judge;
  const sessions = schedule?.sessions || [];
  const scored = scorecards.filter((s: any) => ['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(s.status)).length;
  const totalScore = Object.values(scores).reduce((sum, s) => sum + (s.score || 0), 0);

  // Group by date
  const byDate: Record<string, any[]> = {};
  sessions.forEach((s: any) => {
    const d = new Date(s.date).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  });

  return (
    <main className="min-h-screen bg-[#0a0e1a]">
      {/* Header */}
      <div className="bg-[#111827] border-b border-[#1e293b]">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#7c3aed20] border border-[#7c3aed30] flex items-center justify-center text-2xl text-[#7c3aed] font-bold">
                {judge?.name?.[0]}
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{judge?.name}</h1>
                <p className="text-sm text-gray-400">{judge?.judgeType} Judge · {judge?.organisation}</p>
              </div>
            </div>
            {lastUpdated && (
              <div className="text-right">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="text-xs text-gray-500">Live</span></div>
                <p className="text-xs text-gray-600 mt-0.5">Updated {lastUpdated.toLocaleTimeString()}</p>
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-8">
            <div><p className="text-2xl font-bold text-white">{sessions.length}</p><p className="text-xs text-gray-500 uppercase">Sessions</p></div>
            <div><p className="text-2xl font-bold text-green-400">{scored}</p><p className="text-xs text-gray-500 uppercase">Scored</p></div>
            <div><p className="text-2xl font-bold text-yellow-400">{sessions.length - scored}</p><p className="text-xs text-gray-500 uppercase">Remaining</p></div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Scoring form overlay */}
        {activeScorecard && (
          <div className="mb-6 rounded-xl border border-[#7c3aed30] bg-[#111827] p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Score: {activeScorecard.teamName}</h2>
                <p className="text-sm text-[#7c3aed]">{activeScorecard.projectName}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-2xl font-bold text-white">{totalScore}</p>
                  <p className="text-xs text-gray-500">of 100</p>
                </div>
                <button onClick={() => setActiveScorecard(null)} className="text-gray-500 hover:text-white text-xl">✕</button>
              </div>
            </div>

            {message && (
              <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${message.includes('Error') || message.includes('required') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                {message}
              </div>
            )}

            <div className="space-y-4">
              {(() => {
                // Categories group the questions; they are not questions
                // themselves. Filtering them here means a scorecard created
                // before the rubric became two-level cannot show one as
                // scoreable.
                const rows = (activeScorecard.criterionScores || []).filter(
                  (cs: any) => !!cs.parentId,
                );

                // Running subtotal per category, so a judge can see how much
                // of each section is used without adding it up themselves.
                const subtotals: Record<string, number> = {};
                for (const cs of rows) {
                  if (!cs.parentId) continue;
                  subtotals[cs.parentId] =
                    (subtotals[cs.parentId] || 0) + (scores[cs.criterionId]?.score || 0);
                }

                let lastCategory: string | null = null;

                return rows.map((cs: any) => {
                const showHeader = !!cs.parentId && cs.parentId !== lastCategory;
                if (cs.parentId) lastCategory = cs.parentId;
                const catUsed = cs.parentId ? subtotals[cs.parentId] || 0 : 0;
                const catDone = cs.categoryMaxScore ? catUsed === cs.categoryMaxScore : false;

                const s = scores[cs.criterionId] || { score: null, comment: '' };
                const isLocked = ['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(activeScorecard.status);
                const commentMissing = cs.requiresComment && !(s.comment || '').trim();

                return (
                  <div key={cs.criterionId}>
                  {showHeader && (
                    <div className="flex items-baseline justify-between px-1 pb-2 pt-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-[#7c3aed]">
                        {cs.categoryName}
                      </span>
                      <span className={`text-xs ${catDone ? 'text-green-400' : 'text-gray-500'}`}>
                        {catUsed} / {cs.categoryMaxScore}
                      </span>
                    </div>
                  )}
                  <div className="rounded-xl border border-[#1e293b] bg-[#0a0e1a] p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="text-sm font-semibold text-white">{cs.criterionName}</span>
                        {cs.requiresComment && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Comment required</span>}
                      </div>
                      <span className="text-xs text-gray-400">Max: {cs.maxScore}</span>
                    </div>
                    {cs.guidanceText && <p className="text-xs text-gray-400 mb-3">{cs.guidanceText}</p>}

                    <div className="flex items-center gap-4 mb-2">
                      <input type="range" min="0" max={cs.maxScore} step="1" value={s.score ?? 0} disabled={isLocked}
                        onChange={(e) => setScores(prev => ({ ...prev, [cs.criterionId]: { ...prev[cs.criterionId], score: parseInt(e.target.value) } }))}
                        className="flex-1 h-2 bg-[#1e293b] rounded-full appearance-none cursor-pointer accent-[#7c3aed] disabled:opacity-50" />
                      <input type="number" min="0" max={cs.maxScore} value={s.score ?? ''} disabled={isLocked}
                        onChange={(e) => setScores(prev => ({ ...prev, [cs.criterionId]: { ...prev[cs.criterionId], score: e.target.value === '' ? null : Math.min(parseInt(e.target.value) || 0, cs.maxScore) } }))}
                        className="w-16 bg-[#0a0e1a] border border-[#334155] rounded-lg px-3 py-1.5 text-center text-sm font-mono text-white outline-none disabled:opacity-50" />
                      <span className="text-xs text-gray-500">/ {cs.maxScore}</span>
                    </div>

                    {/* Score bar */}
                    <div className="h-1.5 bg-[#1e293b] rounded-full overflow-hidden mb-3">
                      <div className={`h-full rounded-full transition-all ${(s.score || 0) / cs.maxScore > 0.7 ? 'bg-green-500' : (s.score || 0) / cs.maxScore > 0.4 ? 'bg-[#7c3aed]' : 'bg-yellow-500'}`}
                        style={{ width: `${((s.score || 0) / cs.maxScore) * 100}%` }} />
                    </div>

                    {/* Anchors */}
                    {cs.scoringAnchors && (
                      <div className="flex gap-2 mb-3 flex-wrap">
                        {(typeof cs.scoringAnchors === 'string' ? JSON.parse(cs.scoringAnchors) : cs.scoringAnchors)?.map((anchor: any, ai: number) => {
                          const isActive = s.score !== null && s.score >= anchor.min && s.score <= anchor.max;
                          return (
                            <span key={ai} className={`text-xs px-2 py-1 rounded-md border ${isActive ? 'border-[#7c3aed40] bg-[#7c3aed15] text-[#7c3aed]' : 'border-[#334155] bg-[#1a2236] text-gray-500'}`}>
                              {anchor.min}-{anchor.max}: {anchor.label}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    <textarea value={s.comment || ''} disabled={isLocked}
                      onChange={(e) => setScores(prev => ({ ...prev, [cs.criterionId]: { ...prev[cs.criterionId], comment: e.target.value } }))}
                      placeholder={cs.requiresComment ? 'Why this score? Required.' : 'Optional comment...'}
                      rows={2}
                      className={`w-full bg-[#111827] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none resize-none disabled:opacity-50 border ${
                        commentMissing ? 'border-yellow-500/50' : 'border-[#475569]'
                      } focus:border-[#7c3aed]`} />
                    {commentMissing && (
                      <p className="mt-1.5 text-xs text-yellow-400">
                        A comment is required before this scorecard can be submitted.
                      </p>
                    )}
                  </div>
                  </div>
                );
                });
              })()}

              {/* Overall assessment */}
              <div className="rounded-xl border border-[#1e293b] bg-[#0a0e1a] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">Overall assessment</h3>
                <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} placeholder="Strengths..." rows={2}
                  disabled={['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(activeScorecard.status)}
                  className="w-full bg-[#111827] border border-[#475569] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none resize-none disabled:opacity-50 focus:border-[#7c3aed]" />
                <textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} placeholder="Areas for improvement..." rows={2}
                  disabled={['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(activeScorecard.status)}
                  className="w-full bg-[#111827] border border-[#475569] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none resize-none disabled:opacity-50 focus:border-[#7c3aed]" />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#1e293b]">
              <div className="flex items-center gap-3">
                <div className="h-2 w-48 bg-[#1e293b] rounded-full overflow-hidden">
                  <div className="h-full bg-[#7c3aed] rounded-full transition-all" style={{ width: `${totalScore}%` }} />
                </div>
                <span className="text-sm font-bold text-white">{totalScore}/100</span>
              </div>
              {!['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(activeScorecard.status) ? (
                <div className="flex gap-2">
                  <button onClick={() => saveOrSubmit(false)} disabled={saving}
                    className="px-4 py-2 bg-[#1e293b] hover:bg-[#334155] text-white text-sm rounded-lg disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save draft'}
                  </button>
                  <button onClick={() => saveOrSubmit(true)} disabled={saving}
                    className="px-4 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-medium rounded-lg disabled:opacity-50">
                    {saving ? 'Submitting...' : 'Submit scorecard'}
                  </button>
                </div>
              ) : (
                <span className="text-sm text-green-400">✓ Submitted {activeScorecard.submittedAt ? new Date(activeScorecard.submittedAt).toLocaleString() : ''}</span>
              )}
            </div>
          </div>
        )}

        {/* Schedule cards */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1" />
          <DriftMetronome scorecards={scorecards} sessions={sessions} />
        </div>
        <div className="space-y-8">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-[#1e293b] bg-[#111827] py-16 text-center">
              <p className="text-gray-500">No sessions assigned yet. This page auto-refreshes.</p>
            </div>
          ) : Object.entries(byDate).map(([date, daySessions]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-[#7c3aed] uppercase tracking-wider mb-4">{date}</h2>
              <div className="space-y-3">
                {(daySessions as any[]).map((s: any) => {
                  const sc = scorecards.find((c: any) => c.sessionId === s.sessionId);
                  const canScore = sc?.canScore;
                  const isSubmitted = ['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(sc?.status);

                  return (
                    <div key={s.sessionId} className={`rounded-xl border overflow-hidden ${
                      isSubmitted ? 'border-green-500/20 bg-green-500/5' : canScore ? 'border-[#7c3aed30] bg-[#111827]' : 'border-[#1e293b] bg-[#111827]'
                    }`}>
                      <div className="px-5 py-3 border-b border-[#1e293b] flex items-center justify-between bg-[#1a2236]">
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[70px]">
                            <p className="text-lg font-bold text-white font-mono">
                              {new Date(s.startTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false })}
                            </p>
                            <p className="text-xs text-gray-500">
                              to {new Date(s.endTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false })}
                            </p>
                          </div>
                          <div className="h-8 w-px bg-[#334155]" />
                          <div>
                            <p className="text-sm font-medium text-white">{s.room}</p>
                            <p className="text-xs text-gray-500">
                              {s.fellowJudges?.length > 0 ? `with ${s.fellowJudges.map((j: any) => j.name).join(', ')}` : 'Solo'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {sc?.totalScore !== null && sc?.totalScore !== undefined && (
                            <span className="text-sm font-bold text-white">{sc.totalScore}/100</span>
                          )}
                          <StatusBadge status={isSubmitted ? 'SUBMITTED' : canScore ? 'IN_PROGRESS' : sc?.status || s.stage} />
                        </div>
                      </div>
                      <div className="px-5 py-4">
                        <h3 className="text-base font-semibold text-white">{s.team.name}</h3>
                        <p className="text-sm text-[#7c3aed] mt-0.5">{s.team.projectName}</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {s.team.track && <span className="px-2 py-0.5 rounded bg-[#7c3aed15] border border-[#7c3aed30] text-xs text-[#7c3aed]">{s.team.track}</span>}
                          {s.team.department && <span className="px-2 py-0.5 rounded bg-[#3b82f615] border border-[#3b82f630] text-xs text-[#3b82f6]">{s.team.department}</span>}
                          {s.team.organisation && <span className="px-2 py-0.5 rounded bg-[#1e293b] border border-[#334155] text-xs text-gray-300">{s.team.organisation}</span>}
                        </div>
                        {(s.team.problemStatement || s.team.solutionSummary) && (
                          <div className="mt-3 rounded-lg border border-[#1e293b] bg-[#0f172a] px-3 py-2.5">
                            {s.team.problemStatement && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-gray-500">Problem</p>
                                <p className="mt-0.5 text-sm leading-relaxed text-gray-300">{s.team.problemStatement}</p>
                              </div>
                            )}
                            {s.team.solutionSummary && (
                              <div className={s.team.problemStatement ? 'mt-2.5' : ''}>
                                <p className="text-[10px] uppercase tracking-wider text-gray-500">Solution</p>
                                <p className="mt-0.5 text-sm leading-relaxed text-gray-300">{s.team.solutionSummary}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {s.team.vendorTools && (
                          <div className="mt-2">
                            <div className="flex flex-wrap gap-1.5">
                              {s.team.vendorTools.split(',').map((tool: string, ti: number) => (
                                <span key={ti} className="px-2 py-0.5 rounded bg-[#1a2236] border border-[#334155] text-xs text-gray-300">{tool.trim()}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Score button */}
                        <div className="mt-3">
                          {canScore && (
                            <button onClick={() => openScorecard(sc)}
                              className="px-4 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-[#7c3aed25]">
                              Score now
                            </button>
                          )}
                          {isSubmitted && (
                            <button onClick={() => openScorecard(sc)}
                              className="px-4 py-2 bg-[#1e293b] hover:bg-[#334155] text-white text-sm rounded-lg">
                              View scores ({sc.totalScore}/100)
                            </button>
                          )}
                          {!canScore && !isSubmitted && sc?.status === 'DRAFT' && (
                            <button onClick={() => openScorecard(sc)}
                              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded-lg">
                              Continue draft ({sc.totalScore}/100)
                            </button>
                          )}
                          {!canScore && !isSubmitted && !sc?.status?.includes('DRAFT') && sc?.eventClosed && (
                            <span className="text-sm text-gray-500">Event closed</span>
                          )}
                          {!canScore && !isSubmitted && !sc?.status?.includes('DRAFT') && !sc?.eventClosed && (
                            <span className="text-sm text-gray-500">Waiting for organizer to start session</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center py-8">
          <p className="text-xs text-gray-600">UOB Innovation Challenge 2026</p>
          <p className="text-xs text-gray-700 mt-1">Auto-refreshes every 30 seconds.</p>
        </div>
      </div>
    </main>
  );
}
