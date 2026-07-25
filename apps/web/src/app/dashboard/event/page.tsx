'use client';
import { useState, useEffect } from 'react';
import { useQuery } from '@/lib/use-graphql';
import { useAuthStore } from '@/lib/auth-store';
import { createClient } from '@/lib/graphql-client';
import { EVENTS_QUERY, ROOMS_QUERY, JUDGES_QUERY } from '@/lib/queries';

const TRACKS_QUERY = `query T($eventId: String!) { tracks(eventId: $eventId) { id name description status } }`;
const TIMESLOTS_QUERY = `query TS($eventId: String!) { timeSlots(eventId: $eventId) { id date startTime endTime slotType } }`;
const ROUNDS_QUERY = `query RD($eventId: String!) { judgingRounds(eventId: $eventId) { id name roundNumber status allowedTiers teamCount advanceCount } }`;
const SCORING_TEMPLATE_QUERY = `query ST($eventId: String!) { scoringTemplates(eventId: $eventId) { id name status criteria { id name maxScore description displayOrder requiresComment } } }`;
const TEAMS_QUERY = `query TM($eventId: String!) { teams(eventId: $eventId) { id name projectName trackName status organisation techStack teamLeadEmail } }`;
const CREATE_EVENT = `mutation CE($input: CreateEventInput!) { createEvent(input: $input) { id name status } }`;
const UPDATE_EVENT = `mutation UE($id: String!, $input: UpdateEventInput!) { updateEvent(id: $id, input: $input) { id name status } }`;
const CREATE_ROOM = `mutation CR($input: CreateRoomInput!) { createRoom(input: $input) { id name } }`;
const DELETE_ROOM = `mutation DR($id: String!) { deleteRoom(id: $id) { id } }`;
const CREATE_TRACK = `mutation CT($input: CreateTrackInput!) { createTrack(input: $input) { id name } }`;
const DELETE_TRACK = `mutation DT($id: String!) { deleteTrack(id: $id) { id } }`;
const GEN_SLOTS = `mutation GS($input: GenerateTimeSlotsInput!) { generateTimeSlots(input: $input) { id slotType } }`;
const CLEAR_SLOTS = `mutation CS($eventId: String!, $date: String!) { clearTimeSlots(eventId: $eventId, date: $date) }`;
const CREATE_TEMPLATE = `mutation CST($input: CreateScoringTemplateInput!) { createScoringTemplate(input: $input) { id name status } }`;
const ADD_CRITERION = `mutation AC($input: AddCriterionInput!) { addCriterion(input: $input) { id name maxScore } }`;
const DELETE_CRITERION = `mutation DC($id: String!) { removeCriterion(id: $id) }`;

const TZ = 'Asia/Singapore';
const fmt = (s: string, o?: any) => { if (!s) return '-'; return new Date(s.length === 10 ? s + 'T00:00:00+08:00' : s).toLocaleDateString('en-SG', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', ...o }); };
const toDS = (s: string) => { if (!s) return ''; return new Date(s).toLocaleDateString('en-CA', { timeZone: TZ }); };
const getEvDays = (a: string, b: string) => { if (!a || !b) return []; const d: string[] = []; const s = new Date(a+'T00:00:00+08:00'); const e = new Date(b+'T00:00:00+08:00'); for (let x = new Date(s); x <= e; x.setTime(x.getTime()+86400000)) d.push(x.toLocaleDateString('en-CA',{timeZone:TZ})); return d; };
const slDS = (s: string) => s ? new Date(s).toLocaleDateString('en-CA',{timeZone:TZ}) : '';

export default function EventSetupPage() {
  const { data: evData } = useQuery<any>(EVENTS_QUERY);
  const event = evData?.events?.[0];
  const eventId = event?.id;
  const { data: roomData } = useQuery<any>(ROOMS_QUERY, eventId ? { eventId } : undefined);
  const { data: judgeData } = useQuery<any>(JUDGES_QUERY, eventId ? { eventId } : undefined);
  const token = useAuthStore((s) => s.token);

  const rooms = roomData?.rooms || [];
  const judges = judgeData?.judges || [];

  const [tracks, setTracks] = useState<any[]>([]);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [template, setTemplate] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [msgT, setMsgT] = useState<'ok'|'err'>('ok');
  const [expanded, setExpanded] = useState<string|null>(null);

  // Event creation form
  const [ef, setEf] = useState({ name: 'UOB Innovation Challenge 2026', description: 'Annual innovation hackathon. Top 10 advance to Finals.', location: 'UOB Plaza, Level 5 Auditorium', timezone: 'Asia/Singapore', startDate: '', endDate: '', sessionDurationMinutes: 20, minJudgesPerTeam: 3, maxJudgesPerTeam: 5 });
  const [newRoom, setNewRoom] = useState({ name: '', capacity: 25 });
  const [newTrack, setNewTrack] = useState({ name: '', description: '' });
  const [slotCfg, setSlotCfg] = useState({ startTime: '09:00', endTime: '17:00', lunchStart: '12:00', lunchEnd: '13:00', session: 20, brk: 5 });

  useEffect(() => {
    if (!eventId || !token) return;
    const c = createClient(token);
    c.query(TRACKS_QUERY, { eventId }).toPromise().then(r => setTracks(r.data?.tracks || []));
    c.query(TIMESLOTS_QUERY, { eventId }).toPromise().then(r => setTimeSlots(r.data?.timeSlots || []));
    c.query(ROUNDS_QUERY, { eventId }).toPromise().then(r => setRounds(r.data?.judgingRounds || []));
    c.query(TEAMS_QUERY, { eventId }).toPromise().then(r => setTeams(r.data?.teams || []));
    c.query(SCORING_TEMPLATE_QUERY, { eventId }).toPromise().then(r => {
      const t = r.data?.scoringTemplates || [];
      setTemplate(t.find((x: any) => x.status === 'ACTIVE') || t[0] || null);
    });
  }, [eventId, token]);

  useEffect(() => {
    if (event) {
      setEf(f => ({ ...f, name: event.name || f.name, description: event.description || f.description, location: event.location || f.location,
        timezone: event.timezone || f.timezone, startDate: toDS(event.startDate) || f.startDate, endDate: toDS(event.endDate) || f.endDate,
        sessionDurationMinutes: event.sessionDurationMinutes || f.sessionDurationMinutes,
        minJudgesPerTeam: event.minJudgesPerTeam || f.minJudgesPerTeam, maxJudgesPerTeam: event.maxJudgesPerTeam || f.maxJudgesPerTeam }));
    }
  }, [event]);

  const show = (m: string, t: 'ok'|'err' = 'ok') => { setMsg(m); setMsgT(t); if (t === 'ok') setTimeout(() => setMsg(''), 5000); };
  const run = async (mut: string, vars: any) => { const c = createClient(token); const r = await c.mutation(mut, vars).toPromise(); if (r.error) { show(r.error.message, 'err'); return null; } return r.data; };

  const reload = () => setTimeout(() => window.location.reload(), 800);

  const [importErrors, setImportErrors] = useState<any[]>([]);
  const uploadCsv = async (ep: string, file: File) => {
    if (!eventId || !token) return;
    setImportErrors([]);
    const fd = new FormData(); fd.append('file', file); fd.append('eventId', eventId);
    try {
      const r = await fetch(`/api/import/${ep}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
      const d = await r.json();
      if (d.imported !== undefined) {
        show(`${d.imported} ${ep} imported${d.errors?.length ? ` (${d.errors.length} rejected)` : ''}`);
        if (d.errors?.length) { setImportErrors(d.errors); }
        else { reload(); }
      } else if (d.message) { show(d.message, 'err'); reload(); }
    } catch (e: any) { show(e.message, 'err'); }
  };

  // Derived data
  const criteria = template?.criteria || [];
  const totalPoints = criteria.reduce((s: number, c: any) => s + (c.maxScore || 0), 0);
  const eventDays = getEvDays(ef.startDate, ef.endDate);
  const judgingSlots = timeSlots.filter((s: any) => s.slotType === 'JUDGING').length;

  // Step completion checks
  const s1 = !!event; // Event created
  const s2 = criteria.length > 0 && totalPoints === 100; // Scoring criteria set
  const s3 = tracks.length > 0; // Tracks exist
  const s4 = teams.length > 0; // Teams uploaded
  const s5 = judges.length > 0; // Judges uploaded
  const s6 = rooms.length > 0; // Rooms created
  const s7 = timeSlots.filter((s: any) => s.slotType === 'JUDGING').length > 0; // Time slots generated
  const allReady = s1 && s2 && s3 && s4 && s5 && s6 && s7;

  // ─── Capacity Validation ───
  const minJudges = ef.minJudgesPerTeam || 3;
  const maxJudges = ef.maxJudgesPerTeam || 5;
  const totalJudgeCapacity = judges.reduce((s: number, j: any) => s + (j.maxSessions || 4), 0);
  const judgeSessionsNeeded = teams.length * minJudges;
  const sessionDuration = ef.sessionDurationMinutes || 20;
  const slotsPerRoom = timeSlots.filter((s: any) => s.slotType === 'JUDGING').length / Math.max(rooms.length, 1);
  const roomSessionCapacity = rooms.length * slotsPerRoom;

  const capacityWarnings: string[] = [];
  if (allReady) {
    if (totalJudgeCapacity < judgeSessionsNeeded) {
      capacityWarnings.push(
        `Judge capacity shortage: ${teams.length} teams × ${minJudges} min judges = ${judgeSessionsNeeded} judge-sessions needed, but total judge capacity is only ${totalJudgeCapacity}. Increase judge max_sessions or reduce min judges per team.`
      );
    }
    if (roomSessionCapacity < teams.length) {
      capacityWarnings.push(
        `Room/slot shortage: ${rooms.length} rooms × ~${Math.round(slotsPerRoom)} slots = ${Math.round(roomSessionCapacity)} session slots, but ${teams.length} teams need scheduling. Add more rooms or time slots.`
      );
    }
    if (judges.length < minJudges) {
      capacityWarnings.push(
        `Not enough judges: ${judges.length} judges uploaded but each team needs at least ${minJudges}.`
      );
    }
    // Check individual judge loads
    const avgLoad = judgeSessionsNeeded / judges.length;
    const overloadedJudges = judges.filter((j: any) => (j.maxSessions || 4) < avgLoad);
    if (overloadedJudges.length > judges.length * 0.5) {
      capacityWarnings.push(
        `Most judges have low max_sessions (avg needed: ${avgLoad.toFixed(1)} per judge). Consider increasing capacity for: ${overloadedJudges.slice(0, 3).map((j: any) => j.name + '(' + j.maxSessions + ')').join(', ')}`
      );
    }
  }

  // New criterion form
  const [newCrit, setNewCrit] = useState({ name: '', maxScore: 10, description: '', requiresComment: false });
  const tierColors: Record<string,string> = { L1: '#3b82f6', L2: '#f59e0b', L3: '#ef4444' };
  const tierLabels: Record<string,string> = { L1: 'Leads & Vendors', L2: 'ED / MD', L3: 'MEC' };
  const typeColors: Record<string,string> = { TECHNICAL: '#3b82f6', BUSINESS: '#10b981', DOMAIN: '#7c3aed', INNOVATION: '#f59e0b', EXECUTIVE: '#ef4444' };

  const [editingStep, setEditingStep] = useState<number|null>(null);

  const stepStyle = (num: number, done: boolean, active: boolean, isEditing: boolean) => ({
    wrapper: { marginBottom: 16, opacity: active ? 1 : 0.35, pointerEvents: (active ? 'auto' : 'none') as any, transition: 'opacity 0.3s' },
    circle: { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 as any,
      background: done ? 'rgba(16,185,129,0.15)' : active ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
      color: done ? '#10b981' : active ? '#a78bfa' : '#6b7a90',
      border: `1.5px solid ${done ? 'rgba(16,185,129,0.3)' : active ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)'}` },
    title: { fontSize: 15, fontWeight: 500, color: done ? '#10b981' : active ? '#fff' : '#6b7a90', flex: 1 },
    body: { marginLeft: 42, padding: '16px 20px', borderRadius: 12,
      border: `1px solid ${isEditing ? 'rgba(124,58,237,0.3)' : done ? 'rgba(16,185,129,0.15)' : active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'}`,
      background: isEditing ? 'rgba(124,58,237,0.03)' : 'rgba(255,255,255,0.02)' },
  });

  return (
    <div>
      <style>{`
        .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
        .hdr h1{font-size:22px;font-weight:600;color:#fff}
        .hdr-sub{font-size:14px;color:#94a3b8;margin-top:2px}
        .msg{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;position:fixed;top:16px;right:16px;z-index:50}
        .msg-ok{background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#34d399}
        .msg-err{background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171}
        .btn{padding:7px 16px;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid;transition:all 0.15s}
        .btn-pri{background:#7c3aed;border-color:#7c3aed;color:#fff}.btn-pri:hover{background:#6d28d9}
        .btn-sec{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1);color:#fff}.btn-sec:hover{background:rgba(255,255,255,0.08)}
        .btn-sm{padding:5px 12px;font-size:12px}
        .btn-danger{background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.15);color:#f87171}.btn-danger:hover{background:rgba(239,68,68,0.15)}
        .btn-success{background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.15);color:#10b981}.btn-success:hover{background:rgba(16,185,129,0.15)}
        .fg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .fg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
        .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,0.04)}
        .row:last-child{border-bottom:none}
        .lbl{font-size:14px;color:#94a3b8}
        .val{font-size:14px;color:#fff;font-weight:500}
        .inp{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:7px 12px;color:#fff;font-size:14px;width:100%}
        .inp:focus{border-color:rgba(124,58,237,0.4);outline:none}
        .inp-sm{width:80px;text-align:center}
        .item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.02);border:0.5px solid rgba(255,255,255,0.04);margin-bottom:6px}
        .item-name{font-size:14px;color:#fff;font-weight:500}
        .item-sub{font-size:12px;color:#6b7a90}
        .add-row{display:flex;gap:8px;margin-top:8px}
        .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;margin:2px}
        .ready-banner{padding:16px 20px;border-radius:12px;border:1.5px solid rgba(16,185,129,0.3);background:rgba(16,185,129,0.06);text-align:center;margin-top:20px}
        .tbl{width:100%;border-collapse:collapse;table-layout:fixed}
        .tbl th{text-align:left;font-size:11px;color:#6b7a90;font-weight:600;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,0.06)}
        .tbl td{padding:6px 4px;font-size:13px;border-bottom:0.5px solid rgba(255,255,255,0.03);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      `}</style>

      {msg && <div className={`msg ${msgT === 'ok' ? 'msg-ok' : 'msg-err'}`}>{msg}</div>}

      <div className="hdr">
        <div>
          <h1>Event setup</h1>
          <p className="hdr-sub">{s1 ? event.name : 'Create your event to get started'}</p>
        </div>
        {s1 && <span style={{ padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, background: event.status === 'ACTIVE' ? 'rgba(16,185,129,0.1)' : 'rgba(107,122,144,0.1)', color: event.status === 'ACTIVE' ? '#10b981' : '#6b7a90' }}>{event.status}</span>}
      </div>

      {/* ─── STEP 1: Create Event ─── */}
      <div style={stepStyle(1, s1, true, editingStep === 1).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(1, s1, true, editingStep === 1).circle}>{(s1 && editingStep !== 1) ? '\u2713' : 1}</div>
          <span style={stepStyle(1, s1, true, editingStep === 1).title}>Create event</span>
          {s1 && editingStep !== 1 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(1)}>Edit</button>}
          {editingStep === 1 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s1 && editingStep !== 1 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(1, s1, true, editingStep === 1).body}>
        {(!s1 || editingStep === 1) ? (
          <>
            <div className="fg">
              <div><div className="lbl" style={{marginBottom:4}}>Event name</div><input className="inp" value={ef.name} onChange={e => setEf({...ef, name: e.target.value})} /></div>
              <div><div className="lbl" style={{marginBottom:4}}>Location</div><input className="inp" value={ef.location} onChange={e => setEf({...ef, location: e.target.value})} /></div>
              <div><div className="lbl" style={{marginBottom:4}}>Start date</div><input type="date" className="inp" value={ef.startDate} onChange={e => setEf({...ef, startDate: e.target.value})} /></div>
              <div><div className="lbl" style={{marginBottom:4}}>End date</div><input type="date" className="inp" value={ef.endDate} onChange={e => setEf({...ef, endDate: e.target.value})} /></div>
            </div>
            <div><div className="lbl" style={{marginBottom:4,marginTop:10}}>Description</div><textarea className="inp" rows={2} value={ef.description} onChange={e => setEf({...ef, description: e.target.value})} /></div>
            <div className="fg" style={{marginTop:10}}>
              <div><div className="lbl" style={{marginBottom:4}}>Session duration (min)</div><input type="number" className="inp" value={ef.sessionDurationMinutes} onChange={e => setEf({...ef, sessionDurationMinutes: Number(e.target.value)})} /></div>
              <div className="fg">
                <div><div className="lbl" style={{marginBottom:4}}>Min judges</div><input type="number" className="inp" value={ef.minJudgesPerTeam} onChange={e => setEf({...ef, minJudgesPerTeam: Number(e.target.value)})} /></div>
                <div><div className="lbl" style={{marginBottom:4}}>Max judges</div><input type="number" className="inp" value={ef.maxJudgesPerTeam} onChange={e => setEf({...ef, maxJudgesPerTeam: Number(e.target.value)})} /></div>
              </div>
            </div>
            <button className="btn btn-pri" style={{marginTop:14}} onClick={async () => {
              if (!ef.name || !ef.startDate || !ef.endDate) { show('Name and dates required', 'err'); return; }
              if (s1) {
                const input: any = { name: ef.name, description: ef.description, location: ef.location, timezone: ef.timezone,
                  sessionDurationMinutes: ef.sessionDurationMinutes, minJudgesPerTeam: ef.minJudgesPerTeam, maxJudgesPerTeam: ef.maxJudgesPerTeam };
                if (ef.startDate) input.startDate = ef.startDate + 'T00:00:00+08:00';
                if (ef.endDate) input.endDate = ef.endDate + 'T00:00:00+08:00';
                const d = await run(UPDATE_EVENT, { id: event.id, input });
                if (d) { show('Event updated'); setEditingStep(null); reload(); }
              } else {
                const d = await run(CREATE_EVENT, { input: { ...ef, startDate: ef.startDate+'T00:00:00+08:00', endDate: ef.endDate+'T00:00:00+08:00' } });
                if (d) { show('Event created'); reload(); }
              }
            }}>{s1 ? 'Save changes' : 'Create event'}</button>
          </>
        ) : (
          <div>
            <div className="fg">
              <div className="row"><span className="lbl">Name</span><span className="val">{event.name}</span></div>
              <div className="row"><span className="lbl">Location</span><span className="val">{event.location || '-'}</span></div>
              <div className="row"><span className="lbl">Dates</span><span className="val">{fmt(ef.startDate)} - {fmt(ef.endDate)}</span></div>
              <div className="row"><span className="lbl">Session</span><span className="val">{ef.sessionDurationMinutes} min, {ef.minJudgesPerTeam}-{ef.maxJudgesPerTeam} judges</span></div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ─── STEP 2: Scoring Criteria ─── */}
      <div style={stepStyle(2, s2, s1, editingStep === 2).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(2, s2, s1, editingStep === 2).circle}>{(s2 && editingStep !== 2) ? '\u2713' : 2}</div>
          <span style={stepStyle(2, s2, s1, editingStep === 2).title}>{`Scoring criteria (${criteria.length}) — ${totalPoints}/100 pts`}</span>
          {s2 && s1 && editingStep !== 2 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(2)}>Edit</button>}
          {editingStep === 2 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s2 && editingStep !== 2 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(2, s2, s1, editingStep === 2).body}>
          {criteria.length > 0 && criteria.map((c: any, i: number) => (
            <div className="item" key={c.id} style={{alignItems:'flex-start'}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="item-name">{c.name}</span>
                  <span style={{fontSize:16,fontWeight:600,color:'#a78bfa'}}>{c.maxScore}</span>
                  {c.requiresComment && <span style={{fontSize:10,color:'#f59e0b',padding:'1px 6px',borderRadius:3,background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.2)'}}>Comment required</span>}
                </div>
                {c.description && <div className="item-sub" style={{marginTop:2}}>{c.description}</div>}
                <div style={{marginTop:6,height:6,borderRadius:3,background:'rgba(255,255,255,0.06)',overflow:'hidden',maxWidth:200}}>
                  <div style={{height:'100%',borderRadius:3,background:'#7c3aed',width:`${totalPoints > 0 ? (c.maxScore/100)*100 : 0}%`}} />
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={async () => {
                if (!confirm(`Remove "${c.name}"?`)) return;
                await run(DELETE_CRITERION, { id: c.id });
                show(`"${c.name}" removed`); reload();
              }}>Remove</button>
            </div>
          ))}
          {totalPoints !== 100 && criteria.length > 0 && (
            <div style={{padding:'8px 12px',borderRadius:8,background: totalPoints > 100 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',border: `1px solid ${totalPoints > 100 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,marginBottom:8}}>
              <span style={{fontSize:13,color: totalPoints > 100 ? '#f87171' : '#f59e0b'}}>Total is {totalPoints} — must equal 100</span>
            </div>
          )}
          <div style={{padding:12,borderRadius:8,background:'rgba(255,255,255,0.02)',border:'0.5px solid rgba(255,255,255,0.06)',marginTop:8}}>
            <div style={{fontSize:11,color:'#6b7a90',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:8}}>Add criterion</div>
            <div className="fg">
              <input className="inp" placeholder="Criterion name" value={newCrit.name} onChange={e => setNewCrit({...newCrit, name: e.target.value})} />
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <input type="number" className="inp" style={{width:70}} placeholder="Pts" value={newCrit.maxScore} onChange={e => setNewCrit({...newCrit, maxScore: Number(e.target.value)})} />
                <label style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer',whiteSpace:'nowrap'}}>
                  <input type="checkbox" checked={newCrit.requiresComment} onChange={e => setNewCrit({...newCrit, requiresComment: e.target.checked})} /> Comment req.
                </label>
              </div>
            </div>
            <input className="inp" placeholder="Description (optional)" value={newCrit.description} onChange={e => setNewCrit({...newCrit, description: e.target.value})} style={{marginTop:6}} />
            <button className="btn btn-pri btn-sm" style={{marginTop:8}} onClick={async () => {
              if (!newCrit.name.trim()) return;
              let tplId = template?.id;
              if (!tplId) {
                const res = await run(CREATE_TEMPLATE, { input: { eventId, name: ef.name } });
                if (!res) return;
                tplId = res.createScoringTemplate.id;
              }
              await run(ADD_CRITERION, { input: { templateId: tplId, name: newCrit.name.trim(), maxScore: newCrit.maxScore, description: newCrit.description || undefined, requiresComment: newCrit.requiresComment, weight: 1.0 } });
              show(`"${newCrit.name}" added`);
              setNewCrit({ name: '', maxScore: 10, description: '', requiresComment: false });
              reload();
            }}>Add</button>
          </div>
          {criteria.length === 0 && <div style={{fontSize:13,color:'#f59e0b',marginTop:8}}>Add criteria totaling 100 points. Common: Innovation (20), Business Impact (40), Feasibility (10), Collaboration (20), Bonus (10)</div>}
        </div>
      </div>

      {/* ─── STEP 3: Challenge Tracks ─── */}
      <div style={stepStyle(3, s3, s1 && s2, editingStep === 3).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(3, s3, s1 && s2, editingStep === 3).circle}>{(s3 && editingStep !== 3) ? '\u2713' : 3}</div>
          <span style={stepStyle(3, s3, s1 && s2, editingStep === 3).title}>{`Challenge tracks (${tracks.length})`}</span>
          {s7 && s1 && s2 && s3 && s4 && s5 && s6 && editingStep !== 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(7)}>Edit</button>}
          {editingStep === 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s3 && editingStep !== 3 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(3, s3, s1 && s2, editingStep === 3).body}>
        {tracks.map(t => (
          <div className="item" key={t.id}>
            <div><span className="item-name">{t.name}</span>{t.description && <div className="item-sub">{t.description}</div>}</div>
            <button className="btn btn-danger btn-sm" onClick={async () => { if (!confirm(`Remove "${t.name}"?`)) return; await run(DELETE_TRACK, { id: t.id }); show(`"${t.name}" removed`); reload(); }}>Remove</button>
          </div>
        ))}
        <div className="add-row">
          <input className="inp" placeholder="Track name" value={newTrack.name} onChange={e => setNewTrack({...newTrack, name: e.target.value})} style={{flex:2}} />
          <input className="inp" placeholder="Description" value={newTrack.description} onChange={e => setNewTrack({...newTrack, description: e.target.value})} style={{flex:3}} />
          <button className="btn btn-pri btn-sm" onClick={async () => {
            if (!newTrack.name.trim()) return;
            await run(CREATE_TRACK, { input: { eventId, name: newTrack.name.trim(), description: newTrack.description } });
            show(`"${newTrack.name}" added`); setNewTrack({ name: '', description: '' }); reload();
          }}>Add</button>
        </div>
        {!s2 && <div style={{fontSize:13,color:'#f59e0b',marginTop:8}}>Add at least one track to continue</div>}
      </div>
      </div>

      {/* ─── STEP 4: Upload Teams ─── */}
      <div style={stepStyle(4, s4, s1 && s2 && s3, editingStep === 4).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(4, s4, s1 && s2 && s3, editingStep === 4).circle}>{(s4 && editingStep !== 4) ? '\u2713' : 4}</div>
          <span style={stepStyle(4, s4, s1 && s2 && s3, editingStep === 4).title}>{`Teams (${teams.length})`}</span>
          {s7 && s1 && s2 && s3 && s4 && s5 && s6 && editingStep !== 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(7)}>Edit</button>}
          {editingStep === 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s4 && editingStep !== 4 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(4, s4, s1 && s2 && s3, editingStep === 4).body}>
        {teams.length > 0 && (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {tracks.map(t => { const c = teams.filter((tm: any) => tm.trackName === t.name).length; return c > 0 ? <span key={t.id} className="pill" style={{background:'rgba(124,58,237,0.1)',color:'#a78bfa',border:'1px solid rgba(124,58,237,0.2)'}}>{t.name}: {c}</span> : null; })}
              </div>
              <button className="btn btn-danger btn-sm" onClick={async () => {
                if (!confirm(`Remove all ${teams.length} teams? You can re-upload the CSV.`)) return;
                for (const t of teams) { await run(`mutation D($id: String!) { deleteTeam(id: $id) { id } }`, { id: t.id }); }
                show(`All teams removed`); reload();
              }}>Clear all</button>
            </div>
            {expanded === 'teams' ? (
              <div style={{maxHeight:350,overflowY:'auto',marginBottom:8}}>
                <table className="tbl"><thead><tr><th style={{width:'20%'}}>Team</th><th style={{width:'24%'}}>Project</th><th style={{width:'15%'}}>Track</th><th style={{width:'15%'}}>Org</th><th style={{width:'14%'}}>Tech</th><th style={{width:'12%'}}></th></tr></thead>
                <tbody>{teams.map(t => (<tr key={t.id}>
                  <td style={{color:'#fff',fontWeight:500}}>{t.name}</td>
                  <td style={{color:'#94a3b8'}}>{t.projectName}</td>
                  <td><span className="pill" style={{background:'rgba(124,58,237,0.1)',color:'#a78bfa'}}>{t.trackName}</span></td>
                  <td style={{color:'#94a3b8'}}>{t.organisation}</td>
                  <td style={{color:'#6b7a90',fontSize:11}}>{t.techStack}</td>
                  <td style={{textAlign:'right'}}><span style={{fontSize:11,color:'#ef4444',cursor:'pointer'}} onClick={async () => {
                    if (!confirm(`Remove "${t.name}"?`)) return;
                    await run(`mutation D($id: String!) { deleteTeam(id: $id) { id } }`, { id: t.id });
                    show(`"${t.name}" removed`); reload();
                  }}>Remove</span></td>
                </tr>))}</tbody></table>
                <button className="btn btn-sec btn-sm" style={{marginTop:6}} onClick={() => setExpanded(null)}>Collapse</button>
              </div>
            ) : (
              <button className="btn btn-sec btn-sm" onClick={() => setExpanded('teams')}>View all {teams.length} teams</button>
            )}
          </>
        )}
        <div style={{display:'flex',gap:10,alignItems:'center',marginTop:8}}>
          <label className="btn btn-pri btn-sm" style={{cursor:'pointer'}}>
            {teams.length > 0 ? 'Upload more' : 'Upload teams CSV'}
            <input type="file" accept=".csv" style={{display:'none'}} onChange={e => { if (e.target.files?.[0]) uploadCsv('teams', e.target.files[0]); }} />
          </label>
          <span style={{fontSize:12,color:'#6b7a90'}}>Columns: team_name, project_name, track_name, team_lead_email, organisation, tech_stack</span>
        </div>
        {!s3 && <div style={{fontSize:13,color:'#f59e0b',marginTop:8}}>Upload a CSV to load teams. Track names must match the tracks above.</div>}

      </div>
      </div>

      {/* ─── STEP 5: Upload Judges ─── */}
      <div style={stepStyle(5, s5, s1 && s2 && s3 && s4, editingStep === 5).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(5, s5, s1 && s2 && s3 && s4, editingStep === 5).circle}>{(s5 && editingStep !== 5) ? '\u2713' : 5}</div>
          <span style={stepStyle(5, s5, s1 && s2 && s3 && s4, editingStep === 5).title}>{`Judges (${judges.length})`}</span>
          {s7 && s1 && s2 && s3 && s4 && s5 && s6 && editingStep !== 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(7)}>Edit</button>}
          {editingStep === 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s5 && editingStep !== 5 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(5, s5, s1 && s2 && s3 && s4, editingStep === 5).body}>
        {judges.length > 0 && (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {Object.entries(tierLabels).map(([tier, label]) => {
                const c = judges.filter((j: any) => j.judgeTier === tier).length;
                return c > 0 ? <span key={tier} className="pill" style={{background:`${tierColors[tier]}18`,color:tierColors[tier],border:`1px solid ${tierColors[tier]}30`}}>{tier} {label}: {c}</span> : null;
              })}
              </div>
              <button className="btn btn-danger btn-sm" onClick={async () => {
                if (!confirm(`Remove all ${judges.length} judges? You can re-upload the CSV.`)) return;
                for (const j of judges) { await run(`mutation D($id: String!) { deleteJudge(id: $id) { id } }`, { id: j.id }); }
                show('All judges removed'); reload();
              }}>Clear all</button>
            </div>
            {expanded === 'judges' ? (
              <div style={{maxHeight:350,overflowY:'auto',marginBottom:8}}>
                <table className="tbl"><thead><tr><th style={{width:'20%'}}>Name</th><th style={{width:'20%'}}>Organisation</th><th style={{width:'12%'}}>Type</th><th style={{width:'8%'}}>Tier</th><th style={{width:'22%'}}>Email</th><th style={{width:'8%'}}>Max</th><th style={{width:'10%'}}></th></tr></thead>
                <tbody>{judges.map((j: any) => (<tr key={j.id}><td style={{color:'#fff',fontWeight:500}}>{j.name}</td><td style={{color:'#94a3b8'}}>{j.organisation}</td><td><span className="pill" style={{background:`${typeColors[j.judgeType]||'#6b7a90'}15`,color:typeColors[j.judgeType]||'#6b7a90'}}>{j.judgeType}</span></td><td style={{color:tierColors[j.judgeTier]||'#6b7a90',fontWeight:600}}>{j.judgeTier||'L1'}</td><td style={{color:'#6b7a90',fontSize:11}}>{j.email}</td><td style={{color:'#94a3b8',textAlign:'center'}}>{j.maxSessions}</td>
                  <td style={{textAlign:'right'}}><span style={{fontSize:11,color:'#ef4444',cursor:'pointer'}} onClick={async () => {
                    if (!confirm(`Remove "${j.name}"?`)) return;
                    await run(`mutation D($id: String!) { deleteJudge(id: $id) { id } }`, { id: j.id });
                    show(`"${j.name}" removed`); reload();
                  }}>Remove</span></td></tr>))}</tbody></table>
                <button className="btn btn-sec btn-sm" style={{marginTop:6}} onClick={() => setExpanded(null)}>Collapse</button>
              </div>
            ) : (
              <button className="btn btn-sec btn-sm" onClick={() => setExpanded('judges')}>View all {judges.length} judges</button>
            )}
          </>
        )}
        <div style={{display:'flex',gap:10,alignItems:'center',marginTop:8}}>
          <label className="btn btn-pri btn-sm" style={{cursor:'pointer'}}>
            {judges.length > 0 ? 'Upload more' : 'Upload judges CSV'}
            <input type="file" accept=".csv" style={{display:'none'}} onChange={e => { if (e.target.files?.[0]) uploadCsv('judges', e.target.files[0]); }} />
          </label>
          <span style={{fontSize:12,color:'#6b7a90'}}>Columns: name, email, judge_type, judge_tier, organisation, max_sessions</span>
        </div>
        {!s4 && <div style={{fontSize:13,color:'#f59e0b',marginTop:8}}>Upload a CSV to load judges.</div>}
      </div>
      </div>

      {/* ─── STEP 6: Rooms ─── */}
      <div style={stepStyle(6, s6, s1 && s2 && s3 && s4 && s5, editingStep === 6).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(6, s6, s1 && s2 && s3 && s4 && s5, editingStep === 6).circle}>{(s6 && editingStep !== 6) ? '\u2713' : 6}</div>
          <span style={stepStyle(6, s6, s1 && s2 && s3 && s4 && s5, editingStep === 6).title}>{`Rooms (${rooms.length})`}</span>
          {s7 && s1 && s2 && s3 && s4 && s5 && s6 && editingStep !== 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(7)}>Edit</button>}
          {editingStep === 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s6 && editingStep !== 6 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(6, s6, s1 && s2 && s3 && s4 && s5, editingStep === 6).body}>
        {rooms.map(r => (
          <div className="item" key={r.id}>
            <span className="item-name">{r.name}</span>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span className="item-sub">Cap: {r.capacity || 25}</span>
              <button className="btn btn-danger btn-sm" onClick={async () => { if (!confirm(`Remove "${r.name}"?`)) return; await run(DELETE_ROOM, { id: r.id }); show(`"${r.name}" removed`); reload(); }}>Remove</button>
            </div>
          </div>
        ))}
        <div className="add-row" key="room-add-form">
          <input className="inp" placeholder="Room name" value={newRoom.name} onChange={e => setNewRoom({...newRoom, name: e.target.value})} style={{flex:1}} onKeyDown={e => { if (e.key === 'Enter') { /* add */ } }} />
          <input type="number" className="inp" style={{width:70}} placeholder="Cap" value={newRoom.capacity} onChange={e => setNewRoom({...newRoom, capacity: Number(e.target.value)})} />
          <button className="btn btn-pri btn-sm" onClick={async () => {
            if (!newRoom.name.trim()) return;
            await run(CREATE_ROOM, { input: { eventId, name: newRoom.name.trim(), capacity: newRoom.capacity } });
            show(`"${newRoom.name}" added`); setNewRoom({ name: '', capacity: 25 }); reload();
          }}>Add</button>
        </div>
        {!s6 && <div style={{fontSize:13,color:'#f59e0b',marginTop:8}}>Add at least one room</div>}
      </div>
      </div>

      {/* ─── STEP 7: Time Slots ─── */}
      <div style={stepStyle(7, s7, s1 && s2 && s3 && s4 && s5 && s6, editingStep === 7).wrapper}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={stepStyle(7, s7, s1 && s2 && s3 && s4 && s5 && s6, editingStep === 7).circle}>{(s7 && editingStep !== 7) ? '\u2713' : 7}</div>
          <span style={stepStyle(7, s7, s1 && s2 && s3 && s4 && s5 && s6, editingStep === 7).title}>{`Time slots (${judgingSlots})`}</span>
          {s7 && s1 && s2 && s3 && s4 && s5 && s6 && editingStep !== 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(7)}>Edit</button>}
          {editingStep === 7 && <button className="btn btn-sec btn-sm" onClick={() => setEditingStep(null)}>Done editing</button>}
          {s7 && editingStep !== 7 && <span style={{ fontSize: 11, color: '#10b981', padding: '2px 8px', borderRadius: 4, background: 'rgba(16,185,129,0.08)' }}>Done</span>}
        </div>
        <div style={stepStyle(7, s7, s1 && s2 && s3 && s4 && s5 && s6, editingStep === 7).body}>
        {eventDays.length > 0 ? (
          <>
            {/* Existing slots */}
            {eventDays.map(day => {
              const daySlots = timeSlots.filter((s: any) => slDS(s.date) === day && s.slotType === 'JUDGING');
              return daySlots.length > 0 ? (
                <div className="item" key={day}>
                  <span className="item-name">{fmt(day)}</span>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span className="item-sub">{daySlots.length} slots</span>
                    <button className="btn btn-danger btn-sm" onClick={async () => { if (!confirm(`Clear slots for ${fmt(day)}?`)) return; await run(CLEAR_SLOTS, { eventId, date: day }); show('Slots cleared'); reload(); }}>Clear</button>
                  </div>
                </div>
              ) : null;
            })}
            {/* Config */}
            <div style={{padding:12,borderRadius:8,background:'rgba(255,255,255,0.02)',border:'0.5px solid rgba(255,255,255,0.06)',marginTop:8}}>
              <div className="fg">
                <div style={{display:'flex',gap:6,alignItems:'center'}}><span className="lbl" style={{fontSize:12,minWidth:50}}>Hours</span><input type="time" className="inp" style={{width:90}} value={slotCfg.startTime} onChange={e => setSlotCfg({...slotCfg, startTime: e.target.value})} /><span style={{color:'#6b7a90'}}>to</span><input type="time" className="inp" style={{width:90}} value={slotCfg.endTime} onChange={e => setSlotCfg({...slotCfg, endTime: e.target.value})} /></div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}><span className="lbl" style={{fontSize:12,minWidth:50}}>Lunch</span><input type="time" className="inp" style={{width:90}} value={slotCfg.lunchStart} onChange={e => setSlotCfg({...slotCfg, lunchStart: e.target.value})} /><span style={{color:'#6b7a90'}}>to</span><input type="time" className="inp" style={{width:90}} value={slotCfg.lunchEnd} onChange={e => setSlotCfg({...slotCfg, lunchEnd: e.target.value})} /></div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                {eventDays.map(day => {
                  const existing = timeSlots.filter((s: any) => slDS(s.date) === day && s.slotType === 'JUDGING').length;
                  return (
                    <button key={day} className={`btn btn-sm ${existing > 0 ? 'btn-success' : 'btn-pri'}`} style={{flex:1}} onClick={async () => {
                      if (existing > 0 && !confirm(`${fmt(day)} already has ${existing} slots. Regenerate?`)) return;
                      const d = await run(GEN_SLOTS, { input: { eventId, date: day, operatingStart: slotCfg.startTime, operatingEnd: slotCfg.endTime, sessionDurationMinutes: slotCfg.session, breakDurationMinutes: slotCfg.brk, lunchStart: slotCfg.lunchStart, lunchEnd: slotCfg.lunchEnd } });
                      if (d) { show(`${d.generateTimeSlots.length} slots for ${fmt(day)}`); reload(); }
                    }}>{fmt(day)} {existing > 0 ? `(${existing})` : 'Generate'}</button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div style={{fontSize:13,color:'#f59e0b'}}>Set event dates in Step 1 first</div>
        )}
      </div>
      </div>

      {/* ─── Ready banner ─── */}
      {allReady && (
        <div className="ready-banner">
          <div style={{fontSize:18,fontWeight:500,color:'#10b981',marginBottom:6}}>Ready to schedule</div>
          <div style={{fontSize:14,color:'#94a3b8',marginBottom:12}}>{teams.length} teams, {judges.length} judges, {rooms.length} rooms, {judgingSlots} slots, {criteria.length} criteria</div>
          <button className="btn btn-pri" onClick={() => window.location.href = '/dashboard/schedule'}>Go to Schedule</button>
        </div>
      )}
    
      
      {allReady && capacityWarnings.length > 0 && (
        <div style={{marginTop:16,borderRadius:10,border:'1px solid rgba(245,158,11,0.3)',background:'rgba(245,158,11,0.05)',padding:'16px 20px'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <span style={{fontSize:20}}>⚠️</span>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:'#f59e0b'}}>Schedule may not be feasible</div>
              <div style={{fontSize:12,color:'#94a3b8'}}>Fix these issues before generating</div>
            </div>
          </div>
          {capacityWarnings.map((w: string, i: number) => (
            <div key={i} style={{fontSize:13,color:'#fbbf24',padding:'8px 12px',background:'rgba(245,158,11,0.05)',borderRadius:6,marginBottom:i < capacityWarnings.length - 1 ? 8 : 0,borderLeft:'3px solid rgba(245,158,11,0.4)'}}>
              {w}
            </div>
          ))}
        </div>
      )}

      {allReady && capacityWarnings.length === 0 && (
        <div style={{marginTop:16,borderRadius:10,border:'1px solid rgba(52,211,153,0.3)',background:'rgba(52,211,153,0.05)',padding:'16px 20px',display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:20}}>✅</span>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:'#34d399'}}>Ready to schedule</div>
            <div style={{fontSize:12,color:'#94a3b8'}}>
              {teams.length} teams · {judges.length} judges (capacity: {totalJudgeCapacity}) · {rooms.length} rooms · All constraints satisfied
            </div>
          </div>
        </div>
      )}

{importErrors.length > 0 && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}}>
          <div style={{background:"#0f172a",border:"1px solid #334155",borderRadius:12,padding:"24px",maxWidth:560,width:"90%",maxHeight:"70vh",display:"flex",flexDirection:"column" as const}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <div style={{width:36,height:36,borderRadius:8,background:"rgba(239,68,68,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>⚠️</div>
              <div>
                <div style={{fontSize:15,fontWeight:600,color:"#f1f5f9"}}>Import completed with issues</div>
                <div style={{fontSize:13,color:"#94a3b8"}}>{importErrors.length} row{importErrors.length > 1 ? "s" : ""} could not be imported</div>
              </div>
            </div>
            <div style={{flex:1,overflowY:"auto",marginBottom:16,borderRadius:8,border:"1px solid #1e293b",background:"#0a0e1a"}}>
              {importErrors.map((e: any, i: number) => (
                <div key={i} style={{fontSize:13,padding:"10px 14px",borderBottom:i < importErrors.length - 1 ? "1px solid #1e293b" : "none",display:"flex",gap:8}}>
                  <span style={{color:"#64748b",flexShrink:0}}>Row {e.row}</span>
                  <span style={{color:"#f87171"}}>{e.message}</span>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
              <button onClick={() => { setImportErrors([]); window.location.reload(); }} style={{padding:"8px 24px",borderRadius:8,fontSize:14,fontWeight:500,background:"#3b82f6",color:"#fff",border:"none",cursor:"pointer"}}>
                OK, got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
