import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Minus, Save, History, Trash2, X, Check, ChevronLeft, Edit3, FileText, Dumbbell, Zap, Timer, Play, Square, RotateCcw, Volume2, Download, Upload, AlertTriangle, Database, Flame, Eye, EyeOff, Pause, Coffee, Trophy, TrendingUp, BarChart3, ArrowRight, Target } from 'lucide-react';

// Workout programmes with their default exercise templates
const PROGRAMMES = {
  anterior: {
    label: 'Anterior',
    short: 'ANT',
    exercises: [
      { name: 'Heel Raise Goblet Squat', unit: 'kg', sets: 5 },
      { name: 'Leg Extension', unit: 'kg', sets: 3 },
      { name: 'Incline DB Chest Press', unit: 'kg', sets: 4 },
      { name: 'Press Up', unit: 'bw', sets: 3 },
      { name: 'DB Lat Raise', unit: 'kg', sets: 3 },
      { name: 'Bicep Curl', unit: 'kg', sets: 3, superset: true },
      { name: 'Ab Crunch', unit: 'bw', sets: 3 },
    ],
  },
  posterior: {
    label: 'Posterior',
    short: 'POS',
    exercises: [
      { name: 'Standing Hamstring Curl', unit: 'kg', sets: 5 },
      { name: 'Roman Dead Lift', unit: 'kg', sets: 3 },
      { name: 'Lateral Pull Down (narrow/neutral)', unit: 'kg', sets: 4 },
      { name: 'Chest Supported Row (narrow)', unit: 'kg', sets: 3 },
      { name: 'Rear Flys', unit: 'kg', sets: 3 },
      { name: 'Tripcep Push Down Rope', unit: 'kg', sets: 3 },
    ],
  },
};

// Legacy alias kept for existing drafts
const DEFAULT_TEMPLATE = PROGRAMMES.anterior.exercises;

const emptySets = (n) => Array.from({ length: n }, () => ({ reps: '', weight: '', time: '', failure: false, bw: false, warmup: false }));
const emptyWarmups = (n) => Array.from({ length: n }, () => ({ reps: '', weight: '', time: '', failure: false, bw: false, warmup: true }));

const emptyWarmup = () => ({ reps: '', weight: '', time: '', failure: false, bw: false, warmup: true });

// Builds a fresh session. If `lastCounts` is provided (a map of exercise name -> { sets, warmups }),
// the new session will use those counts so the layout matches the previous same-programme session
// (e.g. "I did 4 working sets and 2 warmup sets last time, give me the same layout this time").
const createEmptySession = (template, programme = 'anterior', includedMap = null, lastCounts = null) => ({
  id: Date.now(),
  date: new Date().toISOString().slice(0, 10),
  programme,
  muscleGroup: '',
  durationMin: '',
  whoopRecovery: '',
  whoopRelRecovery: '',
  exercises: template.map((t) => {
    const last = lastCounts?.[t.name];
    const setCount = (last && last.sets > 0) ? last.sets : t.sets;
    const warmupCount = last?.warmups || 0;
    return {
      name: t.name,
      unit: t.unit,
      superset: t.superset || false,
      // Fresh sessions always start with every exercise included. User can toggle off during workout.
      included: true,
      warmupSets: emptyWarmups(warmupCount),
      sets: emptySets(setCount),
    };
  }),
  notes: '',
  rating: '',
});

// Storage helpers
const storage = {
  async getTemplate(programme = null) {
    try {
      // Per-programme template first, fall back to legacy
      if (programme) {
        const r = await window.storage.get(`template:${programme}`);
        if (r) return JSON.parse(r.value);
      }
      const r = await window.storage.get('template');
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async setTemplate(t, programme = null) {
    try {
      const key = programme ? `template:${programme}` : 'template';
      await window.storage.set(key, JSON.stringify(t));
    } catch (e) { console.error(e); }
  },
  async getDraft() {
    try {
      const r = await window.storage.get('draft');
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async setDraft(d) {
    try { await window.storage.set('draft', JSON.stringify(d)); } catch (e) { console.error(e); }
  },
  async clearDraft() {
    try { await window.storage.delete('draft'); } catch (e) { console.error(e); }
  },
  async saveSession(s) {
    try { await window.storage.set(`session:${s.id}`, JSON.stringify(s)); } catch (e) { console.error(e); }
  },
  async listSessions() {
    try {
      const r = await window.storage.list('session:');
      if (!r?.keys) return [];
      const sessions = await Promise.all(r.keys.map(async (k) => {
        try {
          const v = await window.storage.get(k);
          return v ? JSON.parse(v.value) : null;
        } catch { return null; }
      }));
      return sessions.filter(Boolean).sort((a, b) => {
        // Sort by session date (newest first), tie-break by id desc
        const dA = new Date(a.date || 0).getTime();
        const dB = new Date(b.date || 0).getTime();
        if (dB !== dA) return dB - dA;
        return (b.id || 0) - (a.id || 0);
      });
    } catch { return []; }
  },
  async deleteSession(id) {
    try { await window.storage.delete(`session:${id}`); } catch (e) { console.error(e); }
  },
  // One-time migration: clears stored programme templates AND stale draft so the current
  // PROGRAMMES defaults + fresh-toggle logic + trimmed-trailing logic take effect cleanly.
  async runSwapMigration() {
    try {
      const r = await window.storage.get('schema-version');
      const version = r ? Number(r.value) : 0;
      if (version < 5) {
        await window.storage.delete('template:anterior');
        await window.storage.delete('template:posterior');
        await window.storage.delete('template'); // legacy pre-programme key
        await window.storage.delete('draft'); // clear stale draft with phantom trailing cells
        await window.storage.set('schema-version', '5');
      }
      // v6: repair untagged sessions by inferring programme from their exercise list.
      // Anterior signature exercises: Heel Raise Goblet Squat, Bicep Curl, Press Up.
      // Posterior signature exercises: Standing Hamstring Curl, Roman Dead Lift, Tripcep Push Down Rope.
      if (version < 6) {
        const ANTERIOR_SIG = ['Heel Raise Goblet Squat', 'Bicep Curl', 'Press Up', 'Incline DB Chest Press', 'DB Lat Raise', 'Leg Extension', 'Ab Crunch'];
        const POSTERIOR_SIG = ['Standing Hamstring Curl', 'Roman Dead Lift', 'Tripcep Push Down Rope', 'Lateral Pull Down (narrow/neutral)', 'Chest Supported Row (narrow)', 'Rear Flys'];
        const all = await window.storage.list('session:');
        const keys = all?.keys || [];
        let repaired = 0;
        for (const key of keys) {
          try {
            const v = await window.storage.get(key);
            if (!v) continue;
            const s = JSON.parse(v.value);
            if (s.programme === 'anterior' || s.programme === 'posterior') continue;
            // Untagged - infer from exercises
            const names = (s.exercises || []).map((e) => e.name);
            const antScore = names.filter((n) => ANTERIOR_SIG.includes(n)).length;
            const postScore = names.filter((n) => POSTERIOR_SIG.includes(n)).length;
            if (antScore > postScore) s.programme = 'anterior';
            else if (postScore > antScore) s.programme = 'posterior';
            else continue; // truly ambiguous, skip
            await window.storage.set(key, JSON.stringify(s));
            repaired++;
          } catch (_) {}
        }
        await window.storage.set('schema-version', '6');
        if (repaired > 0) console.log(`Repaired ${repaired} untagged session(s).`);
      }
    } catch (e) { console.error('Migration error:', e); }
  },
};

// ============================================================
// Stats Helper Functions - pure calculations over session data
// ============================================================

// Filter to included working sets only (warmups and excluded exercises removed)
const workingSets = (session) => {
  if (!session?.exercises) return [];
  return session.exercises
    .filter((ex) => ex.included !== false)
    .flatMap((ex) => (ex.sets || []).map((s) => ({ ...s, _exercise: ex.name, _unit: ex.unit })));
};

// Sum of set times across working sets
const sessionTUT = (session) => workingSets(session).reduce((sum, s) => sum + (Number(s.time) || 0), 0);

// Total volume = weight × reps across non-BW working sets (kept for legacy/CSV compatibility)
const sessionVolume = (session) => workingSets(session).reduce((sum, s) => {
  if (s.bw || s._unit === 'bw') return sum; // BW exercises excluded from volume
  const w = Number(s.weight) || 0;
  const r = Number(s.reps) || 0;
  return sum + w * r;
}, 0);

// Tonnage for time-based training: sum of (weight × time) across non-BW working sets.
// This is the right progressive-overload metric when sets are timed, not rep-counted.
// Units: kg·s (kilogram-seconds). A heavier set held the same time, or the same weight held longer, both increase this.
const sessionTonnage = (session) => workingSets(session).reduce((sum, s) => {
  if (s.bw || s._unit === 'bw') return sum;
  const w = Number(s.weight) || 0;
  const t = Number(s.time) || 0;
  return sum + w * t;
}, 0);

// Sum of weight across all logged non-BW working sets (raw "weight moved" indicator)
const sessionTotalWeight = (session) => workingSets(session).reduce((sum, s) => {
  if (s.bw || s._unit === 'bw') return sum;
  const w = Number(s.weight) || 0;
  if (w === 0) return sum;
  return sum + w;
}, 0);

// Overall progression score: average % change across matched same-programme exercises.
// Compares each exercise's session-level (weight × time) total this session vs last.
// Returns { score: number (percent), matched: number, components: [{ name, deltaPct, prev, curr }] }
const computeProgressionScore = (current, previous) => {
  if (!current || !previous) return { score: null, matched: 0, components: [] };
  const prevByName = new Map();
  (previous.exercises || []).forEach((ex) => {
    if (ex.included === false) return;
    const total = (ex.sets || []).reduce((sum, s) => {
      const w = Number(s.weight) || 0;
      const t = Number(s.time) || 0;
      const r = Number(s.reps) || 0;
      // For BW exercises use reps × time; for weighted use weight × time (or weight × reps if no time)
      if (ex.unit === 'bw' || s.bw) return sum + (r * (t || 1));
      return sum + (w * (t || 1)) + (w * r);
    }, 0);
    if (total > 0) prevByName.set(ex.name, total);
  });
  const components = [];
  (current.exercises || []).forEach((ex) => {
    if (ex.included === false) return;
    const prevTotal = prevByName.get(ex.name);
    if (!prevTotal) return;
    const total = (ex.sets || []).reduce((sum, s) => {
      const w = Number(s.weight) || 0;
      const t = Number(s.time) || 0;
      const r = Number(s.reps) || 0;
      if (ex.unit === 'bw' || s.bw) return sum + (r * (t || 1));
      return sum + (w * (t || 1)) + (w * r);
    }, 0);
    if (total === 0) return;
    const deltaPct = ((total - prevTotal) / prevTotal) * 100;
    components.push({ name: ex.name, deltaPct, prev: prevTotal, curr: total });
  });
  if (components.length === 0) return { score: null, matched: 0, components: [] };
  const score = components.reduce((sum, c) => sum + c.deltaPct, 0) / components.length;
  return { score, matched: components.length, components };
};

// Count of logged working sets (where at least one of time/reps/weight is set)
const sessionSetCount = (session) => workingSets(session).filter((s) => (Number(s.time) || 0) > 0 || (Number(s.reps) || 0) > 0 || (Number(s.weight) || 0) > 0).length;

// Average set time across logged sets
const sessionAvgSetTime = (session) => {
  const timed = workingSets(session).filter((s) => (Number(s.time) || 0) > 0);
  if (timed.length === 0) return 0;
  return timed.reduce((sum, s) => sum + Number(s.time), 0) / timed.length;
};

// Total reps across working sets
const sessionTotalReps = (session) => workingSets(session).reduce((sum, s) => sum + (Number(s.reps) || 0), 0);

// Get previous session of same programme (excludes the given session id)
const findPreviousSameProgramme = (sessions, currentSession) => {
  const programme = currentSession?.programme;
  if (!programme || !sessions) return null;
  const sorted = [...sessions]
    .filter((s) => s.id !== currentSession.id && s.programme === programme)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted[0] || null;
};

// Detect personal records in the just-saved session
const detectPRs = (currentSession, allSessions) => {
  const prs = [];
  if (!currentSession?.exercises) return prs;
  const history = (allSessions || []).filter((s) => s.id !== currentSession.id);

  currentSession.exercises.filter((ex) => ex.included !== false).forEach((ex) => {
    // Find historical bests for this exercise
    let histMaxWeight = 0;
    let histMaxTime = 0;
    let histMaxReps = 0;
    history.forEach((s) => {
      (s.exercises || []).filter((e) => e.name === ex.name && e.included !== false).forEach((e) => {
        (e.sets || []).forEach((set) => {
          histMaxWeight = Math.max(histMaxWeight, Number(set.weight) || 0);
          histMaxTime = Math.max(histMaxTime, Number(set.time) || 0);
          histMaxReps = Math.max(histMaxReps, Number(set.reps) || 0);
        });
      });
    });

    // Today's bests for this exercise
    let todayMaxWeight = 0;
    let todayMaxTime = 0;
    let todayMaxReps = 0;
    (ex.sets || []).forEach((set) => {
      todayMaxWeight = Math.max(todayMaxWeight, Number(set.weight) || 0);
      todayMaxTime = Math.max(todayMaxTime, Number(set.time) || 0);
      todayMaxReps = Math.max(todayMaxReps, Number(set.reps) || 0);
    });

    // Only count as PR if there was historical data to beat
    const hasHistory = histMaxWeight > 0 || histMaxTime > 0 || histMaxReps > 0;
    if (!hasHistory) return;

    if (todayMaxWeight > histMaxWeight && todayMaxWeight > 0 && ex.unit !== 'bw') {
      prs.push({ exercise: ex.name, type: 'weight', prev: histMaxWeight, current: todayMaxWeight, unit: 'kg' });
    }
    if (todayMaxTime > histMaxTime && todayMaxTime > 0) {
      prs.push({ exercise: ex.name, type: 'time', prev: histMaxTime, current: todayMaxTime, unit: 's' });
    }
    if (todayMaxReps > histMaxReps && todayMaxReps > 0 && ex.unit === 'bw') {
      prs.push({ exercise: ex.name, type: 'reps', prev: histMaxReps, current: todayMaxReps, unit: 'r' });
    }
  });

  return prs;
};

// Generate 3 highlights by biggest % improvement per exercise vs same-programme previous
const generateHighlights = (currentSession, previousSession) => {
  if (!previousSession) return ['First session of this programme - baseline set.'];

  const deltas = [];
  (currentSession.exercises || []).filter((ex) => ex.included !== false).forEach((ex) => {
    const prevEx = (previousSession.exercises || []).find((e) => e.name === ex.name);
    if (!prevEx || prevEx.included === false) return;

    // TUT delta
    const todayTUT = (ex.sets || []).reduce((s, set) => s + (Number(set.time) || 0), 0);
    const prevTUT = (prevEx.sets || []).reduce((s, set) => s + (Number(set.time) || 0), 0);
    if (todayTUT > prevTUT && prevTUT > 0) {
      deltas.push({ exercise: ex.name, type: 'TUT', delta: todayTUT - prevTUT, pct: ((todayTUT - prevTUT) / prevTUT) * 100 });
    }
    // Volume delta
    const todayVol = (ex.sets || []).reduce((s, set) => s + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0);
    const prevVol = (prevEx.sets || []).reduce((s, set) => s + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0);
    if (todayVol > prevVol && prevVol > 0) {
      deltas.push({ exercise: ex.name, type: 'volume', delta: todayVol - prevVol, pct: ((todayVol - prevVol) / prevVol) * 100 });
    }
  });

  deltas.sort((a, b) => b.pct - a.pct);
  const highlights = deltas.slice(0, 3).map((d) => {
    if (d.type === 'TUT') return `${d.exercise}: +${Math.round(d.delta)}s time under tension`;
    return `${d.exercise}: +${Math.round(d.delta)} kg·reps volume`;
  });
  if (highlights.length === 0) highlights.push('Session logged. Consistency compounds.');
  return highlights;
};

// Week-of-year key for grouping (ISO week approximation)
const weekKey = (dateStr) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const start = new Date(y, 0, 1);
  const wk = Math.floor(((d - start) / 86400000 + start.getDay()) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
};

// ============================================================
// Bottom Sheet - Set Editor
// ============================================================
const SetEditor = ({ exercise, setIndex, onChange, onClose, onDeleteSet, isWarmup = false, suggested = null }) => {
  const setsArr = isWarmup ? (exercise.warmupSets || []) : exercise.sets;
  const set = setsArr[setIndex];
  const isBW = exercise.unit === 'bw';

  const updateSet = (patch) => {
    const newSets = setsArr.map((s, i) => i === setIndex ? { ...s, ...patch } : s);
    onChange(isWarmup ? { ...exercise, warmupSets: newSets } : { ...exercise, sets: newSets });
  };

  const bumpReps = (n) => updateSet({ reps: Math.max(0, (parseInt(set.reps) || 0) + n) });
  const bumpWeight = (n) => {
    const current = parseFloat(set.weight) || 0;
    const next = Math.max(0, Math.round((current + n) * 4) / 4);
    updateSet({ weight: next });
  };
  const bumpTime = (n) => updateSet({ time: Math.max(0, (parseInt(set.time) || 0) + n) });

  // Track which fields were pre-filled from suggestions (for visual highlight)
  const [suggestedFields, setSuggestedFields] = useState({ weight: false, reps: false });

  // On first open: pre-fill weight and reps from the suggestion if fields are empty
  useEffect(() => {
    if (!set || !suggested) return;
    const patch = {};
    const newlySuggested = { weight: false, reps: false };
    if ((set.weight === '' || set.weight === 0) && suggested.weight !== '' && suggested.weight !== 0 && !isBW && !set.bw) {
      patch.weight = suggested.weight;
      newlySuggested.weight = true;
    }
    if ((set.reps === '' || set.reps === 0) && suggested.reps !== '' && suggested.reps !== 0) {
      patch.reps = suggested.reps;
      newlySuggested.reps = true;
    }
    if (Object.keys(patch).length > 0) {
      updateSet(patch);
      setSuggestedFields(newlySuggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When user manually edits, clear the "suggested" highlight for that field
  const markEdited = (field) => {
    if (suggestedFields[field]) {
      setSuggestedFields((s) => ({ ...s, [field]: false }));
    }
  };

  if (!set) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={onClose}>
      <div
        className={`w-full bg-neutral-950 border-t-2 rounded-t-2xl p-5 pb-8 ${isWarmup ? 'border-amber-500' : 'border-orange-500'}`}
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className={`text-xs tracking-widest uppercase flex items-center gap-1.5 ${isWarmup ? 'text-amber-400' : 'text-neutral-500'}`} style={{ fontFamily: 'var(--font-display)' }}>
              {isWarmup && <Flame className="w-3 h-3" />}
              {isWarmup ? `Warm-up ${setIndex + 1}` : `Set ${setIndex + 1}`}
            </div>
            <div className="text-lg font-semibold text-white leading-tight">{exercise.name}</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 p-1">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Weight (FIRST - pre-filled from previous session as a suggestion) */}
        {!isBW && !set.bw && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs tracking-widest text-neutral-500 uppercase block" style={{ fontFamily: 'var(--font-display)' }}>
                Weight (kg)
              </label>
              {suggestedFields.weight && (
                <span className="text-[9px] text-neutral-400 tracking-wider font-mono bg-neutral-900 border border-neutral-700 px-1.5 py-0.5 rounded">SUGGESTED</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { markEdited('weight'); bumpWeight(-2.5); }} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
                <Minus className="w-5 h-5 text-neutral-300" />
              </button>
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                value={set.weight}
                onChange={(e) => { markEdited('weight'); updateSet({ weight: e.target.value }); }}
                className={`flex-1 h-14 bg-neutral-900 text-center text-3xl rounded-lg font-mono transition-colors ${
                  suggestedFields.weight ? 'border border-dashed border-neutral-700 text-neutral-500' : 'border border-neutral-800 text-white'
                }`}
                placeholder="0"
              />
              <button onClick={() => { markEdited('weight'); bumpWeight(2.5); }} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
                <Plus className="w-5 h-5 text-neutral-300" />
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {[-5, -1, 1, 5].map((n) => (
                <button key={n} onClick={() => { markEdited('weight'); bumpWeight(n); }} className="flex-1 h-10 bg-neutral-900 border border-neutral-800 text-neutral-300 text-sm rounded-md active:bg-neutral-800 font-mono">
                  {n > 0 ? `+${n}` : n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Time (SECOND - auto-populated from timer, hidden for warmups) */}
        {!isWarmup && (
          <div className="mb-5">
            <label className="text-xs tracking-widest text-neutral-500 uppercase mb-2 block" style={{ fontFamily: 'var(--font-display)' }}>
              Time (seconds)
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => bumpTime(-10)} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
                <Minus className="w-5 h-5 text-neutral-300" />
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={set.time}
                onChange={(e) => updateSet({ time: e.target.value })}
                className="flex-1 h-14 bg-neutral-900 border border-neutral-800 text-center text-3xl text-white rounded-lg font-mono"
                placeholder="0"
              />
              <button onClick={() => bumpTime(10)} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
                <Plus className="w-5 h-5 text-neutral-300" />
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {[-30, 15, 30, 60].map((n) => (
                <button key={n} onClick={() => bumpTime(n)} className="flex-1 h-10 bg-neutral-900 border border-neutral-800 text-neutral-300 text-sm rounded-md active:bg-neutral-800 font-mono">
                  {n > 0 ? `+${n}` : n}s
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reps (THIRD) */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs tracking-widest text-neutral-500 uppercase" style={{ fontFamily: 'var(--font-display)' }}>Reps</label>
            {suggestedFields.reps && (
              <span className="text-[9px] text-neutral-400 tracking-wider font-mono bg-neutral-900 border border-neutral-700 px-1.5 py-0.5 rounded">SUGGESTED</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { markEdited('reps'); bumpReps(-1); }} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
              <Minus className="w-5 h-5 text-neutral-300" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={set.reps}
              onChange={(e) => { markEdited('reps'); updateSet({ reps: e.target.value }); }}
              className={`flex-1 h-14 bg-neutral-900 text-center text-3xl rounded-lg font-mono transition-colors ${
                suggestedFields.reps ? 'border border-dashed border-neutral-700 text-neutral-500' : 'border border-neutral-800 text-white'
              }`}
              placeholder="0"
            />
            <button onClick={() => { markEdited('reps'); bumpReps(1); }} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
              <Plus className="w-5 h-5 text-neutral-300" />
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            {[-5, +5, +10].map((n) => (
              <button key={n} onClick={() => { markEdited('reps'); bumpReps(n); }} className="flex-1 h-10 bg-neutral-900 border border-neutral-800 text-neutral-300 text-sm rounded-md active:bg-neutral-800 font-mono">
                {n > 0 ? `+${n}` : n}
              </button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => updateSet({ bw: !set.bw, weight: !set.bw ? '' : set.weight })}
            className={`flex-1 h-12 rounded-lg border text-sm font-semibold tracking-wide ${set.bw || isBW ? 'bg-orange-500 border-orange-500 text-black' : 'bg-neutral-900 border-neutral-800 text-neutral-300'}`}
          >
            Bodyweight
          </button>
          <button
            onClick={() => updateSet({ failure: !set.failure })}
            className={`flex-1 h-12 rounded-lg border text-sm font-semibold tracking-wide ${set.failure ? 'bg-red-500 border-red-500 text-white' : 'bg-neutral-900 border-neutral-800 text-neutral-300'}`}
          >
            To Failure
          </button>
        </div>

        <div className="flex gap-2">
          {onDeleteSet && (
            <button
              onClick={() => {
                if (typeof window !== 'undefined' && !window.confirm('Delete this set? This cannot be undone.')) return;
                onDeleteSet();
              }}
              className="h-14 w-14 bg-red-950/40 border-2 border-red-800 text-red-400 rounded-lg flex items-center justify-center active:bg-red-900/50"
              aria-label="Delete this set"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          <button onClick={onClose} className="flex-1 h-14 bg-white text-black font-bold tracking-widest rounded-lg" style={{ fontFamily: 'var(--font-display)' }}>
            DONE
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Set Cell (tap to open editor)
// ============================================================
const SetCell = ({ set, unit, onClick, index, prevSet, isWarmup = false, suggested = null }) => {
  const isEmpty = set.reps === '' && set.weight === '' && set.time === '' && !set.failure && !set.bw;
  const hasTime = set.time !== '' && parseFloat(set.time) > 0;
  const hasReps = set.reps !== '' && parseInt(set.reps) > 0;
  const isBW = set.bw || unit === 'bw';

  // Hero priority: time > reps. Same for warmup and working - if a time is logged, show it.
  const heroValue = (hasTime ? set.time : (hasReps ? set.reps : '-'));
  const heroLabel = (hasTime ? 'SEC' : 'REPS');

  // Secondary line: show whatever isn't the hero
  const bits = [];
  if (hasTime && hasReps) bits.push(`${set.reps}r`);
  if (set.failure) bits.push('FAIL');
  else if (isBW) bits.push('BW');
  else if (set.weight !== '') bits.push(`${set.weight}kg`);

  // Delta vs previous session (now applies to both warmups and working sets)
  let delta = null;
  if (prevSet) {
    if (hasTime && prevSet.time !== '' && parseFloat(prevSet.time) > 0) {
      const diff = parseFloat(set.time) - parseFloat(prevSet.time);
      if (Math.abs(diff) >= 1) {
        delta = { value: `${diff > 0 ? '+' : ''}${diff.toFixed(0)}s`, dir: diff > 0 ? 'up' : 'down' };
      } else if (Math.abs(diff) < 1 && diff !== 0) {
        delta = { value: '=', dir: 'equal' };
      }
    } else if (hasReps && prevSet.reps !== '' && parseInt(prevSet.reps) > 0) {
      const diff = parseInt(set.reps) - parseInt(prevSet.reps);
      if (diff !== 0) {
        delta = { value: `${diff > 0 ? '+' : ''}${diff}r`, dir: diff > 0 ? 'up' : 'down' };
      }
    }
  }

  const deltaColor = delta?.dir === 'up' ? 'text-green-400' : delta?.dir === 'down' ? 'text-orange-400' : 'text-neutral-500';

  // Border/bg classes
  let borderClass;
  if (isEmpty) {
    borderClass = isWarmup
      ? 'border-dashed border-amber-800/60 bg-amber-950/10'
      : 'border-dashed border-neutral-800 bg-neutral-950';
  } else {
    borderClass = isWarmup
      ? 'border-amber-600/70 bg-amber-950/30'
      : 'border-neutral-700 bg-neutral-900';
  }

  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-[88px] h-[100px] border-2 flex flex-col items-center justify-between py-2 transition-colors rounded-md px-1 active:bg-neutral-800 ${borderClass}`}
    >
      <div className="flex items-center justify-between w-full px-0.5">
        <span className={`text-[9px] tracking-widest font-semibold uppercase ${isWarmup ? 'text-amber-500' : 'text-neutral-600'}`} style={{ fontFamily: 'var(--font-display)' }}>
          {isWarmup ? 'W/UP' : `SET ${index + 1}`}
        </span>
        {delta && !isEmpty && (
          <span className={`text-[9px] font-mono font-semibold ${deltaColor}`}>
            {delta.dir === 'up' && '↑'}
            {delta.dir === 'down' && '↓'}
            {delta.value}
          </span>
        )}
      </div>
      {isEmpty ? (
        <div className="flex flex-col items-center">
          {suggested ? (
            <>
              <div className="font-mono text-[18px] text-neutral-600 leading-none">{suggested.value}</div>
              <div className="text-[7px] text-neutral-700 tracking-widest mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>SUGGEST</div>
              <div className="font-mono text-[9px] text-neutral-700 mt-0.5 whitespace-nowrap">{suggested.secondary}</div>
            </>
          ) : (
            <Plus className={`w-5 h-5 ${isWarmup ? 'text-amber-700' : 'text-neutral-700'}`} />
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center -my-1">
            <div className={`font-mono text-[28px] leading-none font-bold ${isWarmup ? 'text-amber-200' : 'text-white'}`}>{heroValue}</div>
            <div className="text-[8px] text-neutral-500 tracking-widest mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>{heroLabel}</div>
          </div>
          <div className={`font-mono text-[10px] whitespace-nowrap h-3 ${isWarmup ? 'text-amber-400' : 'text-orange-400'}`}>
            {bits.join(' · ')}
          </div>
        </>
      )}
    </button>
  );
};

// Average cell - shown at end of sets row
const AverageCell = ({ exercise, prev }) => {
  const withTime = exercise.sets.filter(s => s.time !== '' && parseFloat(s.time) > 0);
  if (withTime.length < 2) return null;

  const avgTime = withTime.reduce((a, s) => a + parseFloat(s.time), 0) / withTime.length;
  const isBW = exercise.unit === 'bw';
  const withWeight = exercise.sets.filter(s => !isBW && !s.bw && s.weight !== '');
  const avgWeight = withWeight.length > 0 ? withWeight.reduce((a, s) => a + parseFloat(s.weight), 0) / withWeight.length : null;
  const withReps = exercise.sets.filter(s => s.reps !== '' && parseInt(s.reps) > 0);
  const totalReps = withReps.length > 0 ? withReps.reduce((a, s) => a + parseInt(s.reps), 0) : null;

  // Compare to previous session's avg time for directional indicator
  let delta = null;
  if (prev?.avgTime !== null && prev?.avgTime !== undefined) {
    const diff = avgTime - prev.avgTime;
    if (Math.abs(diff) >= 0.5) delta = diff > 0 ? 'up' : 'down';
  }

  return (
    <div className="shrink-0 w-[88px] h-[100px] border-2 border-green-600/60 bg-green-950/30 flex flex-col items-center justify-between py-2 rounded-md px-1">
      <div className="text-[9px] tracking-widest text-green-400 font-semibold uppercase flex items-center gap-1" style={{ fontFamily: 'var(--font-display)' }}>
        AVG
        {delta === 'up' && <span className="text-green-400">↑</span>}
        {delta === 'down' && <span className="text-orange-400">↓</span>}
      </div>
      <div className="flex flex-col items-center -my-1">
        <div className="font-mono text-[28px] text-green-300 leading-none font-bold">{avgTime.toFixed(1)}</div>
        <div className="text-[8px] text-green-500/70 tracking-widest mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>SEC</div>
      </div>
      <div className="font-mono text-[10px] text-green-400/80 whitespace-nowrap h-3">
        {totalReps !== null && `${totalReps}r`}
        {avgWeight !== null && ` · ${avgWeight.toFixed(1)}kg`}
      </div>
    </div>
  );
};

// ============================================================
// Exercise Row
// ============================================================
const ExerciseRow = ({
  exercise,
  index,
  onChange,
  onEditSet,
  onEditWarmup,
  onDelete,
  onRename,
  onAddSet,
  onRemoveSet,
  onAddWarmup,
  onRemoveWarmup,
  onToggleIncluded,
  prev,
}) => {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(exercise.name);
  const [showPrevDetail, setShowPrevDetail] = useState(false);
  const included = exercise.included !== false; // default true for older data

  const saveName = () => {
    if (nameValue.trim()) onRename(nameValue.trim());
    setEditingName(false);
  };

  // Format previous session summary line
  const prevLine = prev ? (() => {
    const parts = [];
    const d = new Date(prev.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
    parts.push(d);
    if (prev.avgTime !== null) parts.push(`${prev.avgTime.toFixed(1)}s avg`);
    if (prev.avgWeight !== null) parts.push(`${prev.avgWeight.toFixed(1)}kg`);
    if (prev.totalReps !== null) parts.push(`${prev.totalReps}r total`);
    parts.push(`${prev.sets} sets`);
    return parts.join(' · ');
  })() : null;

  // Build suggested values for empty working sets (from last session's same-numbered set)
  const getSuggested = (setIndex) => {
    if (!prev?.setData?.[setIndex]) return null;
    const ps = prev.setData[setIndex];
    const isBW = exercise.unit === 'bw' || ps.bw;
    const hasTime = ps.time !== '' && parseFloat(ps.time) > 0;
    const hasReps = ps.reps !== '' && parseInt(ps.reps) > 0;
    if (!hasTime && !hasReps && !ps.weight) return null;
    const value = hasTime ? `${ps.time}` : (hasReps ? `${ps.reps}` : '-');
    const bits = [];
    if (hasTime && hasReps) bits.push(`${ps.reps}r`);
    if (isBW) bits.push('BW');
    else if (ps.weight !== '' && ps.weight !== 0) bits.push(`${ps.weight}kg`);
    return { value, secondary: bits.join('·') };
  };

  // Build suggested values for empty WARMUP sets (from last session's same-numbered warmup)
  const getWarmupSuggested = (setIndex) => {
    if (!prev?.warmupSetData?.[setIndex]) return null;
    const ps = prev.warmupSetData[setIndex];
    const isBW = exercise.unit === 'bw' || ps.bw;
    const hasReps = ps.reps !== '' && parseInt(ps.reps) > 0;
    const hasWeight = !isBW && ps.weight !== '' && parseFloat(ps.weight) > 0;
    if (!hasReps && !hasWeight && !isBW) return null;
    // Hero value for warmup cells is reps
    const value = hasReps ? `${ps.reps}` : '-';
    const bits = [];
    if (isBW) bits.push('BW');
    else if (hasWeight) bits.push(`${ps.weight}kg`);
    return { value, secondary: bits.join('·') };
  };

  const warmupSets = exercise.warmupSets || [];

  return (
    <div className={`relative border-b border-neutral-900 py-3 ${!included ? 'opacity-40' : ''}`}>
      {/* Right-edge fade hint to suggest horizontal scroll on wider set rows */}
      {included && exercise.sets && exercise.sets.length > 3 && (
        <div className="pointer-events-none absolute top-12 bottom-8 right-0 w-6" style={{ background: 'linear-gradient(to left, #000 0%, transparent 100%)' }} />
      )}
      {/* Header row - toggle on LEFT, name on right */}
      <div className="flex items-center mb-1 pl-2 pr-2 gap-6">
        {/* Include toggle switch (iOS-style, compact) - positioned left so it is never clipped */}
        <button
          onClick={onToggleIncluded}
          role="switch"
          aria-checked={included}
          aria-label="Include in workout"
          className={`shrink-0 relative h-5 w-9 rounded-full transition-colors duration-200 ${
            included ? 'bg-green-500' : 'bg-neutral-800'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 bg-white rounded-full shadow-md transition-transform duration-200 ${
              included ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                className="flex-1 bg-neutral-900 border border-neutral-700 text-white px-2 py-1 rounded text-sm"
              />
              <button onClick={saveName} className="text-green-500">
                <Check className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button onClick={() => { setNameValue(exercise.name); setEditingName(true); }} className="text-left flex items-center gap-2 w-full">
              {exercise.superset && (
                <span className="text-[9px] bg-orange-500 text-black px-1.5 py-0.5 rounded font-bold tracking-widest" style={{ fontFamily: 'var(--font-display)' }}>SS</span>
              )}
              <span className="text-white font-semibold text-[15px] leading-tight truncate">{exercise.name}</span>
              <Edit3 className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* Previous session line (tappable to expand) */}
      {prevLine && (
        <button
          onClick={() => setShowPrevDetail(!showPrevDetail)}
          className="px-1 mb-2 flex items-center gap-1.5 w-full text-left"
        >
          <span className="text-[9px] tracking-widest text-neutral-500 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>LAST</span>
          <span className="text-[10px] text-neutral-500 font-mono truncate flex-1">{prevLine}</span>
          <span className="text-[9px] text-neutral-600">{showPrevDetail ? '▲' : '▼'}</span>
        </button>
      )}

      {/* Previous session full per-set grid (expandable) */}
      {showPrevDetail && prev?.setData && (
        <div className="px-1 mb-3 pb-2 border-b border-neutral-900">
          <div className="text-[9px] tracking-widest text-neutral-600 mb-1" style={{ fontFamily: 'var(--font-display)' }}>PREVIOUS SESSION PER-SET</div>
          <div className="overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex gap-1.5 w-max">
              {prev.setData.map((ps, i) => {
                const isBW = exercise.unit === 'bw' || ps.bw;
                const hasTime = ps.time !== '' && parseFloat(ps.time) > 0;
                const hasReps = ps.reps !== '' && parseInt(ps.reps) > 0;
                const hero = hasTime ? `${ps.time}s` : (hasReps ? `${ps.reps}r` : '-');
                const bits = [];
                if (hasTime && hasReps) bits.push(`${ps.reps}r`);
                if (ps.failure) bits.push('FAIL');
                else if (isBW) bits.push('BW');
                else if (ps.weight !== '' && ps.weight !== 0) bits.push(`${ps.weight}kg`);
                return (
                  <div key={i} className="shrink-0 w-[72px] bg-neutral-950 border border-neutral-800 rounded p-1.5 text-center">
                    <div className="text-[8px] tracking-widest text-neutral-600" style={{ fontFamily: 'var(--font-display)' }}>SET {i + 1}</div>
                    <div className="font-mono text-sm text-neutral-300 font-bold mt-0.5">{hero}</div>
                    <div className="font-mono text-[9px] text-neutral-500 mt-0.5 truncate">{bits.join(' · ') || '—'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Warmup row (if any warmup sets exist, or add button) */}
      {(warmupSets.length > 0 || included) && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 px-1 mb-1">
            <Flame className="w-3 h-3 text-amber-500" />
            <span className="text-[9px] tracking-widest text-amber-500 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>WARM-UP</span>
            <span className="text-[9px] text-neutral-600 font-mono">(not counted in averages)</span>
          </div>
          <div className="overflow-x-auto scrollbar-none -mx-1 px-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex gap-2 pb-1 w-max">
              {warmupSets.map((set, i) => (
                <SetCell
                  key={`w-${i}`}
                  set={set}
                  index={i}
                  unit={exercise.unit}
                  onClick={() => onEditWarmup(i)}
                  isWarmup
                  suggested={getWarmupSuggested(i)}
                />
              ))}
              <div className="flex flex-col gap-1 shrink-0 justify-center">
                <button onClick={onAddWarmup} className="w-8 h-8 bg-amber-950/40 border border-amber-800/60 rounded flex items-center justify-center active:bg-amber-950">
                  <Plus className="w-4 h-4 text-amber-500" />
                </button>
                {warmupSets.length > 0 && (
                  <button onClick={onRemoveWarmup} className="w-8 h-8 bg-amber-950/40 border border-amber-800/60 rounded flex items-center justify-center active:bg-amber-950">
                    <Minus className="w-4 h-4 text-amber-500" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Working sets row */}
      <div className="overflow-x-auto scrollbar-none -mx-1 px-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-2 pb-1 w-max">
          {exercise.sets.map((set, i) => (
            <SetCell
              key={i}
              set={set}
              index={i}
              unit={exercise.unit}
              onClick={() => onEditSet(i)}
              prevSet={prev?.setData?.[i]}
              suggested={getSuggested(i)}
            />
          ))}
          <div className="flex flex-col gap-1 shrink-0 justify-center">
            <button onClick={onAddSet} className="w-8 h-8 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
              <Plus className="w-4 h-4 text-neutral-400" />
            </button>
            {exercise.sets.length > 1 && (
              <button onClick={onRemoveSet} className="w-8 h-8 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
                <Minus className="w-4 h-4 text-neutral-400" />
              </button>
            )}
          </div>
          <AverageCell exercise={exercise} prev={prev} />
        </div>
      </div>
    </div>
  );
};

// ============================================================
// History View
// ============================================================
const HistoryView = ({ sessions, onBack, onDelete, onOpen, onReload }) => {
  const [status, setStatus] = useState('');
  const [diagnostic, setDiagnostic] = useState(null);

  const exportJSON = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: 'ledger-v1',
        sessionCount: sessions.length,
        sessions,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fogt-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      setStatus(`Exported ${sessions.length} sessions to JSON`);
    } catch (e) {
      setStatus(`Export failed: ${e.message}`);
    }
  };

  const exportCSV = () => {
    try {
      const header = ['date','programme','duration_min','whoop_recovery','whoop_rel_recovery','whoop_strain_legacy','rating','exercise','superset','set_num','reps','weight_kg','bodyweight','time_sec','to_failure','notes'];
      const rows = [header];
      sessions.forEach((s) => {
        s.exercises.forEach((ex) => {
          ex.sets.forEach((set, i) => {
            const isBW = set.bw || ex.unit === 'bw';
            rows.push([
              s.date || '',
              s.programme || s.muscleGroup || '',
              s.durationMin || '',
              s.whoopRecovery || '',
              s.whoopRelRecovery || '',
              s.whoopStrain || '',
              s.rating || '',
              ex.name,
              ex.superset ? 'Y' : '',
              i + 1,
              set.reps || '',
              isBW ? '' : (set.weight || ''),
              isBW ? 'Y' : '',
              set.time || '',
              set.failure ? 'Y' : '',
              (s.notes || '').replace(/[\r\n]+/g, ' '),
            ]);
          });
        });
      });
      const escape = (c) => {
        const str = String(c ?? '');
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fogt-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      setStatus(`Exported ${sessions.length} sessions to CSV`);
    } catch (e) {
      setStatus(`Export failed: ${e.message}`);
    }
  };

  const importJSON = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.sessions;
      if (!Array.isArray(list)) throw new Error('File does not contain a sessions array');
      let imported = 0;
      for (const s of list) {
        if (s && s.id && Array.isArray(s.exercises)) {
          await window.storage.set(`session:${s.id}`, JSON.stringify(s));
          imported++;
        }
      }
      setStatus(`Imported ${imported} sessions`);
      onReload?.();
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    }
    e.target.value = '';
  };

  const runDiagnostic = async () => {
    try {
      const all = await window.storage.list();
      const sessionKeys = (all?.keys || []).filter((k) => k.startsWith('session:'));
      const hasTemplate = (all?.keys || []).includes('template') || (all?.keys || []).includes('template:anterior') || (all?.keys || []).includes('template:posterior');
      const hasDraft = (all?.keys || []).includes('draft');
      // Also load every session and report date + programme so we can see which sessions exist and what they're tagged as
      const sessionDetails = [];
      for (const key of sessionKeys) {
        try {
          const v = await window.storage.get(key);
          if (v) {
            const s = JSON.parse(v.value);
            sessionDetails.push({
              date: String(s.date || '').slice(0, 10),
              programme: s.programme || '(none)',
              id: s.id,
            });
          }
        } catch (_) {}
      }
      sessionDetails.sort((a, b) => (b.date > a.date ? 1 : -1));
      setDiagnostic({
        totalKeys: all?.keys?.length || 0,
        sessionKeys: sessionKeys.length,
        hasTemplate,
        hasDraft,
        allKeys: all?.keys || [],
        sessionDetails,
      });
    } catch (e) {
      setDiagnostic({ error: e.message });
    }
  };

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="sticky top-0 bg-black border-b-2 border-neutral-900 px-4 py-4 flex items-center gap-3 z-10">
        <button onClick={onBack} className="text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-2xl text-white tracking-wider flex-1" style={{ fontFamily: 'var(--font-display)' }}>HISTORY</h1>
        <span className="text-xs text-neutral-500 font-mono">{sessions.length} saved</span>
      </div>

      {/* Backup bar */}
      <div className="px-4 py-3 border-b border-neutral-900 bg-neutral-950">
        <div className="text-[10px] tracking-[0.2em] uppercase text-neutral-400 font-semibold mb-2 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-display)' }}>
          <Database className="w-3 h-3" /> Backup & Restore
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={exportCSV}
            disabled={sessions.length === 0}
            className="h-11 bg-orange-500 text-black rounded font-bold text-xs tracking-wider flex items-center justify-center gap-1 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:border disabled:border-neutral-800"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={exportJSON}
            disabled={sessions.length === 0}
            className="h-11 bg-neutral-800 text-white rounded font-bold text-xs tracking-wider flex items-center justify-center gap-1 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:border disabled:border-neutral-800"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
          <label className="h-11 bg-neutral-800 text-white rounded font-bold text-xs tracking-wider flex items-center justify-center gap-1 cursor-pointer" style={{ fontFamily: 'var(--font-display)' }}>
            <Upload className="w-3.5 h-3.5" /> IMPORT
            <input type="file" accept="application/json" onChange={importJSON} className="hidden" />
          </label>
        </div>
        <button
          onClick={runDiagnostic}
          className="mt-2 w-full h-9 bg-transparent border border-neutral-800 text-neutral-400 text-[11px] rounded active:bg-neutral-900 flex items-center justify-center gap-1.5"
        >
          <AlertTriangle className="w-3 h-3" /> Check storage
        </button>
        {status && (
          <div className="mt-2 text-[11px] text-green-400 font-mono text-center">{status}</div>
        )}
        {diagnostic && (
          <div className="mt-2 p-3 bg-black border border-neutral-800 rounded text-[11px] font-mono text-neutral-300 space-y-1">
            {diagnostic.error ? (
              <div className="text-red-400">Error: {diagnostic.error}</div>
            ) : (
              <>
                <div>Total keys: <span className="text-white">{diagnostic.totalKeys}</span></div>
                <div>Session keys: <span className="text-white">{diagnostic.sessionKeys}</span></div>
                <div>Template saved: <span className="text-white">{diagnostic.hasTemplate ? 'yes' : 'no'}</span></div>
                <div>Draft in progress: <span className="text-white">{diagnostic.hasDraft ? 'yes' : 'no'}</span></div>
                {diagnostic.sessionDetails && diagnostic.sessionDetails.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-neutral-900">
                    <div className="text-neutral-400 mb-1">Sessions (newest first):</div>
                    {diagnostic.sessionDetails.map((s, i) => (
                      <div key={i} className="flex justify-between text-[10px]">
                        <span className="text-white">{s.date}</span>
                        <span className={s.programme === 'anterior' ? 'text-orange-400' : s.programme === 'posterior' ? 'text-green-400' : 'text-neutral-500'}>
                          {s.programme}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {diagnostic.allKeys.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-neutral-500">All keys ({diagnostic.allKeys.length})</summary>
                    <div className="mt-1 text-[10px] text-neutral-500 break-all">
                      {diagnostic.allKeys.join(', ')}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="p-8 text-center text-neutral-500 mt-8">
          <Dumbbell className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No sessions logged yet.</p>
          <p className="text-xs mt-1">Complete and save a workout to see it here.</p>
          <p className="text-xs mt-3 text-neutral-600">If you're expecting data here, tap "Check storage" above.</p>
        </div>
      ) : (
        <div>
          {[...sessions].sort((a, b) => {
            const dA = new Date(a.date || 0).getTime();
            const dB = new Date(b.date || 0).getTime();
            if (dB !== dA) return dB - dA;
            return (b.id || 0) - (a.id || 0);
          }).map((s) => {
            // Count working sets (those with any logged data: reps OR weight OR time).
            // Warmup sets are excluded here and counted separately below.
            const totalSets = (s.exercises || []).reduce((a, e) => {
              if (e.included === false) return a;
              return a + (e.sets || []).filter((x) => {
                const hasReps = x.reps !== '' && x.reps !== null && x.reps !== undefined && parseInt(x.reps) > 0;
                const hasWeight = x.weight !== '' && x.weight !== null && x.weight !== undefined && parseFloat(x.weight) > 0;
                const hasTime = x.time !== '' && x.time !== null && x.time !== undefined && parseFloat(x.time) > 0;
                return hasReps || hasWeight || hasTime;
              }).length;
            }, 0);
            // Count warmup sets that had any logged data (reps or weight)
            const totalWarmups = (s.exercises || []).reduce((a, e) => {
              if (e.included === false) return a;
              return a + (e.warmupSets || []).filter((x) => {
                const hasReps = x.reps !== '' && x.reps !== null && x.reps !== undefined && parseInt(x.reps) > 0;
                const hasWeight = x.weight !== '' && x.weight !== null && x.weight !== undefined && parseFloat(x.weight) > 0;
                return hasReps || hasWeight;
              }).length;
            }, 0);
            // Resolve programme display label and force uppercase
            const programmeLabel = s.programme
              ? String(PROGRAMMES[s.programme]?.label || s.programme).toUpperCase()
              : (s.muscleGroup ? String(s.muscleGroup).toUpperCase() : 'SESSION');
            return (
              <button
                key={s.id}
                onClick={() => onOpen(s)}
                className="w-full text-left border-b border-neutral-900 p-4 active:bg-neutral-950"
              >
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <div className="text-white font-semibold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
                      {new Date(s.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                    <div className="text-sm text-neutral-400" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {programmeLabel}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm('Delete this session?')) onDelete(s.id); }}
                    className="text-neutral-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-3 text-xs text-neutral-500 mt-2 font-mono">
                  {s.durationMin && <span>{s.durationMin}min</span>}
                  <span>{totalSets} sets</span>
                  {totalWarmups > 0 && <span className="text-amber-500">{totalWarmups} w/up</span>}
                  {s.whoopRecovery && <span className="text-orange-400">Rec {s.whoopRecovery}%</span>}
                  {s.whoopRelRecovery && <span className="text-orange-400">Rel Rec {s.whoopRelRecovery}</span>}
                  {!s.whoopRelRecovery && s.whoopStrain && <span className="text-orange-400">Strain {s.whoopStrain}</span>}
                  {s.rating && <span>Rating {s.rating}/10</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Timer Widget - Set Timer with 5s countdown, beeps at 30s & 40s
// Supports compact mode (sticky floating bar)
// ============================================================
const TimerWidget = ({ compact = false, onStop, lastLogged = null, onClearLastLogged, onEditLastLogged }) => {
  const [phase, setPhase] = useState('idle'); // idle | countdown | running
  const [countdown, setCountdown] = useState(7);
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(null);
  // Rest timer state
  const [restRunning, setRestRunning] = useState(false);
  const [restPaused, setRestPaused] = useState(false);
  const [restElapsed, setRestElapsed] = useState(0);
  const audioCtxRef = useRef(null);
  const wakeLockRef = useRef(null);
  const phaseRef = useRef(phase);
  const restStartMsRef = useRef(null);
  const restPausedAtRef = useRef(null);
  const restBeepedRef = useRef(new Set());

  // Keep phaseRef in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // --- Audio helpers ---
  const getAudio = () => {
    if (!audioCtxRef.current) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      } catch (e) { /* no audio */ }
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  const beep = (freq, durationMs = 200, vol = 0.5) => {
    const ctx = getAudio();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const dur = durationMs / 1000;
      // Master gain - amplify the whole stack. Doubling perceived loudness vs old sine.
      const master = ctx.createGain();
      master.connect(ctx.destination);
      // Gain envelope: snap on, hold, then exponential decay
      master.gain.setValueAtTime(0, now);
      master.gain.linearRampToValueAtTime(Math.min(1.0, vol * 1.8), now + 0.005);
      master.gain.setValueAtTime(Math.min(1.0, vol * 1.8), now + Math.max(0.01, dur - 0.05));
      master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      // Primary oscillator - triangle wave is louder-sounding than sine but still pleasant
      const osc1 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.value = freq;
      const g1 = ctx.createGain();
      g1.gain.value = 0.85;
      osc1.connect(g1);
      g1.connect(master);
      // Secondary oscillator one octave up at lower volume - adds harmonic richness, perceived as louder
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      osc2.connect(g2);
      g2.connect(master);
      // Subtle square at fundamental for extra punch on the attack
      const osc3 = ctx.createOscillator();
      osc3.type = 'square';
      osc3.frequency.value = freq;
      const g3 = ctx.createGain();
      g3.gain.value = 0.18;
      osc3.connect(g3);
      g3.connect(master);
      osc1.start(now); osc1.stop(now + dur);
      osc2.start(now); osc2.stop(now + dur);
      osc3.start(now); osc3.stop(now + dur);
    } catch (e) { /* ignore */ }
  };

  // --- Wake lock (keep screen on while timer runs) ---
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (e) { /* ignore */ }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch (e) {}
      wakeLockRef.current = null;
    }
  };

  // --- Main timer loop ---
  useEffect(() => {
    if (phase === 'idle') return;

    const startMs = Date.now();
    const beeped = new Set();

    const intervalId = setInterval(() => {
      const totalMs = Date.now() - startMs;

      if (phase === 'countdown') {
        const remaining = Math.max(0, 7 - Math.floor(totalMs / 1000));
        setCountdown(remaining);

        const tickKey = `cd-${remaining}`;
        if (remaining >= 1 && remaining <= 3 && !beeped.has(tickKey)) {
          beeped.add(tickKey);
          beep(600, 80, 0.45);
        }

        if (totalMs >= 7000 && !beeped.has('go')) {
          beeped.add('go');
          beep(1200, 400, 0.6);
          setPhase('running');
        }
      } else if (phase === 'running') {
        const seconds = Math.floor(totalMs / 1000);
        setElapsed(seconds);

        if (seconds === 30 && !beeped.has(30)) {
          beeped.add(30);
          beep(880, 250, 0.6);
          setTimeout(() => beep(880, 250, 0.6), 300);
        }
        if (seconds === 40 && !beeped.has(40)) {
          beeped.add(40);
          beep(1400, 150, 0.7);
          setTimeout(() => beep(1400, 150, 0.7), 200);
          setTimeout(() => beep(1400, 450, 0.7), 400);
        }
      }
    }, 100);

    return () => clearInterval(intervalId);
  }, [phase]);

  // Release wake lock on unmount
  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Rest timer: auto-starts when set timer stops, beeps at 60s/90s/120s ---
  const startRest = () => {
    restStartMsRef.current = Date.now();
    restPausedAtRef.current = null;
    restBeepedRef.current = new Set();
    setRestElapsed(0);
    setRestPaused(false);
    setRestRunning(true);
  };

  const pauseRest = () => {
    if (!restRunning || restPaused) return;
    restPausedAtRef.current = Date.now();
    setRestPaused(true);
  };

  const resumeRest = () => {
    if (!restRunning || !restPaused) return;
    if (restPausedAtRef.current && restStartMsRef.current) {
      const pauseDur = Date.now() - restPausedAtRef.current;
      restStartMsRef.current += pauseDur;
    }
    restPausedAtRef.current = null;
    setRestPaused(false);
  };

  const stopRest = () => {
    restStartMsRef.current = null;
    restPausedAtRef.current = null;
    restBeepedRef.current = new Set();
    setRestElapsed(0);
    setRestPaused(false);
    setRestRunning(false);
  };

  // Rest timer tick loop
  useEffect(() => {
    if (!restRunning || restPaused) return;
    const tick = () => {
      if (!restStartMsRef.current) return;
      const seconds = Math.floor((Date.now() - restStartMsRef.current) / 1000);
      setRestElapsed(seconds);
      // Beep markers at 60s, 90s, 120s (each distinct)
      if (seconds >= 60 && !restBeepedRef.current.has(60)) {
        restBeepedRef.current.add(60);
        beep(660, 220, 0.5); // 1min: single gentle tone
      }
      if (seconds >= 90 && !restBeepedRef.current.has(90)) {
        restBeepedRef.current.add(90);
        beep(880, 250, 0.6); // 90s: double warm tone (sweet spot)
        setTimeout(() => beep(880, 250, 0.6), 320);
      }
      if (seconds >= 120 && !restBeepedRef.current.has(120)) {
        restBeepedRef.current.add(120);
        beep(1100, 180, 0.7); // 2min: urgent triple
        setTimeout(() => beep(1100, 180, 0.7), 230);
        setTimeout(() => beep(1100, 400, 0.7), 460);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restRunning, restPaused]);

  const start = () => {
    getAudio();
    beep(800, 80, 0.35);
    requestWakeLock();
    setFinalTime(null);
    setCountdown(7);
    setElapsed(0);
    setPhase('countdown');
    // Starting a new set means rest is over
    stopRest();
    // Clear the "last logged" chip since we are now beginning the next set
    if (onClearLastLogged) onClearLastLogged();
  };

  const stop = () => {
    if (phaseRef.current === 'running') {
      setFinalTime(elapsed);
      if (onStop) onStop(elapsed);
      // Auto-start rest timer the moment the set ends
      startRest();
    }
    releaseWakeLock();
    setPhase('idle');
  };

  const clearResult = () => {
    setFinalTime(null);
    setCountdown(7);
    setElapsed(0);
  };

  const isRunning = phase === 'running';
  const isCountdown = phase === 'countdown';
  const isActive = isRunning || isCountdown;

  const zone =
    isRunning && elapsed >= 40 ? 'over' :
    isRunning && elapsed >= 30 ? 'zone' :
    isCountdown && countdown <= 3 && countdown > 0 ? 'prep' :
    'neutral';

  const displayValue = isCountdown ? countdown : isRunning ? elapsed : (finalTime ?? 0);
  const progressValue = isRunning ? elapsed : (finalTime ?? 0);
  const progressPct = Math.min(100, (progressValue / 40) * 100);

  const statusLabel = isCountdown ? 'Get Ready' :
    isRunning && zone === 'zone' ? 'In Zone' :
    isRunning && zone === 'over' ? 'Stop Now' :
    isRunning ? 'Working' :
    finalTime !== null ? 'Last Set' : 'Set Timer';

  // --- COMPACT (sticky floating) variant ---
  if (compact) {
    const bgClass =
      zone === 'over' ? 'bg-red-950/95 border-red-500 animate-pulse' :
      zone === 'zone' ? 'bg-green-950/95 border-green-500' :
      zone === 'prep' ? 'bg-orange-950/95 border-orange-500' :
      'bg-neutral-950/95 border-neutral-800';

    const numberColor =
      zone === 'over' ? 'text-red-400' :
      zone === 'zone' ? 'text-green-400' :
      zone === 'prep' ? 'text-orange-400' :
      isCountdown ? 'text-orange-300' : 'text-white';

    // Rest timer display formatting
    // Rest timer display: raw seconds only (no min:sec formatting). Easier to read across the gym.
    const restDisplay = String(restElapsed);
    // Rest zone colouring matches the beep markers
    const restZone =
      restElapsed >= 120 ? 'late' :   // >= 2 min (triple beep fired)
      restElapsed >= 90 ? 'ready' :   // 90-120s (sweet spot)
      restElapsed >= 60 ? 'warming' : // 60-90s (can go)
      'resting';                       // <60s
    // Solid colour stops for the ring + numerals - vivid, very visible
    const restRingColor =
      restZone === 'late' ? '#f97316' :
      restZone === 'ready' ? '#22c55e' :
      restZone === 'warming' ? '#f59e0b' :
      '#38bdf8';
    const restNumColor =
      restZone === 'late' ? 'text-orange-400' :
      restZone === 'ready' ? 'text-green-400' :
      restZone === 'warming' ? 'text-amber-400' :
      'text-sky-300';
    const restZoneLabel =
      restZone === 'late' ? 'TIME TO GO' :
      restZone === 'ready' ? 'READY' :
      restZone === 'warming' ? 'ALMOST' :
      'RESTING';

    // Ring geometry - big circle at the top of the timer area
    const ringSize = 240;
    const ringStroke = 14;
    const ringR = (ringSize - ringStroke) / 2;
    const ringC = 2 * Math.PI * ringR;
    const ringProgress = Math.min(1, restElapsed / 120);
    const ringOffset = ringC * (1 - ringProgress);

    return (
      <div className="space-y-2">
        {/* Just-logged set chip - tap to open the set editor for that cell */}
        {restRunning && lastLogged && (
          <button
            type="button"
            onClick={onEditLastLogged}
            className="w-full text-left rounded-xl border border-neutral-800 bg-neutral-950/95 px-3 py-2 flex items-center justify-between gap-3 active:bg-neutral-900 transition-colors"
            aria-label={`Edit ${lastLogged.isWarmup ? 'warm-up' : 'set'} ${lastLogged.setNumber} for ${lastLogged.exercise}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[9px] tracking-[0.3em] uppercase font-bold text-neutral-500 leading-none mb-1 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-display)' }}>
                <span>{lastLogged.isWarmup ? 'WARM-UP' : `SET ${lastLogged.setNumber}`} JUST LOGGED · {lastLogged.exercise}</span>
              </div>
              <div className="flex items-baseline gap-3 font-mono">
                <span className="text-2xl font-bold text-white leading-none">{lastLogged.time}<span className="text-xs text-neutral-500 ml-0.5">s</span></span>
                {lastLogged.bw ? (
                  <span className="text-sm text-amber-400 font-bold">BW</span>
                ) : lastLogged.weight !== '' && lastLogged.weight !== undefined && lastLogged.weight !== null ? (
                  <span className="text-sm text-orange-400 font-bold">{lastLogged.weight}kg</span>
                ) : null}
                {lastLogged.reps !== '' && lastLogged.reps !== undefined && lastLogged.reps !== null && (
                  <span className="text-xs text-neutral-400">{lastLogged.reps}r</span>
                )}
                {/* Delta vs previous session for the same set */}
                {lastLogged.prevTime && Number(lastLogged.prevTime) > 0 && (
                  (() => {
                    const diff = Number(lastLogged.time) - Number(lastLogged.prevTime);
                    if (Math.abs(diff) < 1) return null;
                    return (
                      <span className={`text-xs font-bold ${diff > 0 ? 'text-green-400' : 'text-orange-400'}`}>
                        {diff > 0 ? '↑+' : '↓'}{Math.abs(Math.round(diff))}s
                      </span>
                    );
                  })()
                )}
              </div>
            </div>
            <Edit3 className="w-4 h-4 text-neutral-500 shrink-0" />
          </button>
        )}
        {/* Rest timer - large stopwatch face overlay above the set timer */}
        {restRunning && (
          <div
            className="rounded-2xl border-2 shadow-2xl backdrop-blur-sm transition-colors duration-200 px-4 pt-5 pb-4"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.92)',
              borderColor: restRingColor,
            }}
          >
            {/* Header row: label + zone status + close button */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Coffee className="w-4 h-4 text-neutral-300" />
                <span className="text-[10px] tracking-[0.3em] uppercase font-bold text-neutral-300" style={{ fontFamily: 'var(--font-display)' }}>
                  {restPaused ? 'Rest · Paused' : 'Rest'}
                </span>
              </div>
              <span
                className="text-[10px] tracking-[0.3em] font-bold uppercase"
                style={{ fontFamily: 'var(--font-display)', color: restRingColor }}
              >
                {restZoneLabel}
              </span>
              <button
                onClick={stopRest}
                className="h-8 w-8 bg-neutral-900 border border-neutral-700 rounded-lg active:bg-neutral-800 flex items-center justify-center"
                aria-label="Stop rest timer"
              >
                <X className="w-4 h-4 text-neutral-300" />
              </button>
            </div>

            {/* Stopwatch face: SVG ring + central time readout */}
            <div className="relative mx-auto" style={{ width: ringSize, height: ringSize, maxWidth: '100%' }}>
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                style={{ transform: 'rotate(-90deg)' }}
                aria-hidden="true"
              >
                {/* Background track */}
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={ringR}
                  fill="none"
                  stroke="#1f1f1f"
                  strokeWidth={ringStroke}
                />
                {/* Progress fill */}
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={ringR}
                  fill="none"
                  stroke={restRingColor}
                  strokeWidth={ringStroke}
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringOffset}
                  style={{ transition: 'stroke-dashoffset 0.3s linear, stroke 0.3s' }}
                />
                {/* Tick marks at 1m (top, 50% of 120s = 180deg from start), 90s (270deg), 2m (360deg = top) */}
                {[
                  { sec: 60, color: '#f59e0b' },
                  { sec: 90, color: '#22c55e' },
                  { sec: 120, color: '#f97316' },
                ].map(({ sec, color }) => {
                  const ang = (sec / 120) * 360; // degrees from start (rotated -90 = top)
                  const rad = (ang * Math.PI) / 180;
                  const inner = ringR - ringStroke / 2 - 4;
                  const outer = ringR + ringStroke / 2 + 4;
                  const cx = ringSize / 2;
                  const cy = ringSize / 2;
                  const x1 = cx + Math.cos(rad) * inner;
                  const y1 = cy + Math.sin(rad) * inner;
                  const x2 = cx + Math.cos(rad) * outer;
                  const y2 = cy + Math.sin(rad) * outer;
                  return <line key={sec} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={3} strokeLinecap="round" />;
                })}
              </svg>
              {/* Centre readout - absolutely positioned over the ring */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div
                  className={`font-mono font-black leading-none tabular-nums ${restNumColor}`}
                  style={{ fontSize: ringSize * 0.36, letterSpacing: '-0.04em' }}
                >
                  {restDisplay}
                </div>
                <div className="text-[10px] tracking-[0.4em] text-neutral-500 font-mono mt-2">
                  SECONDS
                </div>
              </div>
            </div>

            {/* Bottom controls: pause/resume button (large) and tick legend */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={restPaused ? resumeRest : pauseRest}
                className="flex-1 h-12 bg-neutral-900 border border-neutral-700 rounded-lg active:bg-neutral-800 flex items-center justify-center gap-2"
                aria-label={restPaused ? 'Resume rest timer' : 'Pause rest timer'}
              >
                {restPaused
                  ? (<><Play className="w-4 h-4 fill-current text-green-400" /><span className="text-xs tracking-widest font-bold text-neutral-200" style={{ fontFamily: 'var(--font-display)' }}>RESUME</span></>)
                  : (<><Pause className="w-4 h-4 fill-current text-neutral-200" /><span className="text-xs tracking-widest font-bold text-neutral-200" style={{ fontFamily: 'var(--font-display)' }}>PAUSE</span></>)
                }
              </button>
            </div>
            {/* Tick legend below the controls */}
            <div className="mt-3 flex items-center justify-center gap-4 text-[10px] font-mono">
              <span className={`${restElapsed >= 60 ? 'text-amber-400 font-bold' : 'text-neutral-600'}`}>● 1m</span>
              <span className={`${restElapsed >= 90 ? 'text-green-400 font-bold' : 'text-neutral-600'}`}>● 90s</span>
              <span className={`${restElapsed >= 120 ? 'text-orange-400 font-bold' : 'text-neutral-600'}`}>● 2m</span>
            </div>
          </div>
        )}
        {/* Set timer */}
        <div className={`border-2 rounded-xl backdrop-blur-sm transition-colors duration-200 shadow-2xl ${bgClass}`}>
          <div className="flex items-center gap-3 p-3">
          {/* Big number */}
          <div className={`font-mono font-bold leading-none ${numberColor}`} style={{ fontSize: '2.75rem', minWidth: '72px', textAlign: 'center' }}>
            {displayValue}
            <span className="text-sm text-neutral-500 ml-0.5">s</span>
          </div>
          {/* Status + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] tracking-[0.15em] uppercase font-semibold text-neutral-300 truncate" style={{ fontFamily: 'var(--font-display)' }}>
                {statusLabel}
              </span>
            </div>
            <div className="relative">
              <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-100"
                  style={{
                    width: `${progressPct}%`,
                    backgroundColor: progressValue >= 40 ? '#ef4444' : progressValue >= 30 ? '#22c55e' : '#f97316',
                  }}
                />
              </div>
              <div className="absolute top-0 h-1.5 w-0.5 bg-green-400" style={{ left: '75%' }} />
              <div className="absolute top-0 h-1.5 w-0.5 bg-red-400" style={{ left: 'calc(100% - 2px)' }} />
            </div>
          </div>
          {/* Control button */}
          {isActive ? (
            <button
              onClick={stop}
              className="h-14 w-14 bg-red-500 text-white rounded-lg active:bg-red-600 flex items-center justify-center shrink-0"
              aria-label="Stop timer"
            >
              <Square className="w-6 h-6 fill-current" />
            </button>
          ) : (
            <button
              onClick={start}
              className="h-14 w-14 bg-orange-500 text-black rounded-lg active:bg-orange-600 flex items-center justify-center shrink-0"
              aria-label="Start timer"
            >
              <Play className="w-6 h-6 fill-current" />
            </button>
          )}
        </div>
        </div>
      </div>
    );
  }

  // --- FULL variant (not currently used but kept as fallback) ---
  return (
    <div className={`mx-4 mt-4 border-2 rounded-lg p-4 transition-colors duration-200 ${
      zone === 'over' ? 'bg-red-950/60 border-red-500 animate-pulse' :
      zone === 'zone' ? 'bg-green-950/60 border-green-500' :
      zone === 'prep' ? 'bg-orange-950/40 border-orange-500' :
      'bg-neutral-950 border-neutral-800'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Timer className={`w-4 h-4 ${
            zone === 'zone' ? 'text-green-400' : zone === 'over' ? 'text-red-400' : 'text-orange-500'
          }`} />
          <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-neutral-300" style={{ fontFamily: 'var(--font-display)' }}>
            {statusLabel}
          </span>
        </div>
        <span className="text-[9px] tracking-widest text-neutral-500 font-mono">TARGET 30-40s</span>
      </div>
      <div className="text-center py-3">
        <div className={`font-mono font-bold leading-none ${
          zone === 'over' ? 'text-red-400' :
          zone === 'zone' ? 'text-green-400' :
          zone === 'prep' ? 'text-orange-400' :
          isCountdown ? 'text-orange-300' : 'text-white'
        }`} style={{ fontSize: '5.5rem' }}>
          {displayValue}<span className="text-2xl text-neutral-500 ml-2 align-top mt-4 inline-block">s</span>
        </div>
      </div>
      <div className="relative mb-1">
        <div className="h-2 bg-neutral-900 rounded-full overflow-hidden">
          <div className="h-full transition-all duration-100" style={{
            width: `${progressPct}%`,
            backgroundColor: progressValue >= 40 ? '#ef4444' : progressValue >= 30 ? '#22c55e' : '#f97316',
          }} />
        </div>
        <div className="absolute top-0 h-2 w-0.5 bg-green-400" style={{ left: '75%' }} />
        <div className="absolute top-0 h-2 w-0.5 bg-red-400" style={{ left: 'calc(100% - 2px)' }} />
      </div>
      <div className="flex gap-2 mt-4">
        {isActive ? (
          <button onClick={stop} className="flex-1 h-14 bg-red-500 text-white font-bold tracking-[0.2em] rounded-lg flex items-center justify-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
            <Square className="w-5 h-5 fill-current" /> STOP
          </button>
        ) : (
          <button onClick={start} className="flex-1 h-14 bg-orange-500 text-black font-bold tracking-[0.2em] rounded-lg flex items-center justify-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
            <Play className="w-5 h-5 fill-current" /> {finalTime !== null ? 'NEXT SET' : 'START'}
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Custom Confirm Dialog - reliable in iOS PWAs where native confirm() can be blocked
// ============================================================
const ConfirmDialog = ({ title, message, confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL', onConfirm, onCancel, danger = false, holdMs = 2000 }) => {
  // Hold-to-confirm state for danger mode (e.g., overwriting historical data)
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef(null);
  const holdStartRef = useRef(0);
  const completedRef = useRef(false);

  const startHold = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (completedRef.current) return;
    holdStartRef.current = Date.now();
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdTimerRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - holdStartRef.current) / holdMs) * 100);
      setHoldProgress(pct);
      if (pct >= 100 && !completedRef.current) {
        completedRef.current = true;
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        onConfirm();
      }
    }, 30);
  };

  const cancelHold = () => {
    if (completedRef.current) return;
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  };

  // Cleanup on unmount
  useEffect(() => () => { if (holdTimerRef.current) clearInterval(holdTimerRef.current); }, []);

  const borderColor = danger ? 'border-red-500' : 'border-orange-500';
  const confirmBg = danger ? 'bg-red-600' : 'bg-orange-500';
  const confirmActive = danger ? 'active:bg-red-700' : 'active:bg-orange-600';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-6"
      onClick={onCancel}
      style={{
        fontFamily: 'var(--font-body)',
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        zIndex: 9999,
        isolation: 'isolate',
      }}
    >
      <div
        className={`border-2 ${borderColor} rounded-2xl p-5 w-full max-w-sm shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#000000' }}
      >
        <div className="text-xl font-bold text-white mb-2 tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>
          {title}
        </div>
        {message && <div className="text-sm text-neutral-400 mb-5 whitespace-pre-line">{message}</div>}
        {danger && (
          <div className="mb-3 text-[11px] text-red-400 font-mono tracking-wide bg-red-950/40 border border-red-900 rounded p-2">
            HOLD the red button for 2 seconds to overwrite the historic record. Release to cancel.
          </div>
        )}
        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 h-12 bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-lg font-bold tracking-[0.15em] active:bg-neutral-800"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {cancelLabel}
          </button>
          {danger ? (
            <button
              onMouseDown={startHold}
              onMouseUp={cancelHold}
              onMouseLeave={cancelHold}
              onTouchStart={startHold}
              onTouchEnd={cancelHold}
              onTouchCancel={cancelHold}
              onContextMenu={(e) => e.preventDefault()}
              className={`flex-1 h-12 ${confirmBg} ${confirmActive} text-white rounded-lg font-bold tracking-[0.15em] relative overflow-hidden select-none`}
              style={{ fontFamily: 'var(--font-display)', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
            >
              <span
                className="absolute inset-0 bg-white/30 origin-left transition-none"
                style={{ transform: `scaleX(${holdProgress / 100})` }}
              />
              <span className="relative z-10">
                {holdProgress > 0 && holdProgress < 100 ? `${Math.round(holdProgress)}%` : confirmLabel}
              </span>
            </button>
          ) : (
            <button
              onClick={onConfirm}
              className={`flex-1 h-12 ${confirmBg} ${confirmActive} text-black rounded-lg font-bold tracking-[0.15em]`}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Bicep Confetti Overlay - celebratory rainfall shown on save
// ============================================================
const ConfettiOverlay = () => {
  // Generate particles once per mount. Each has its own position, size,
  // speed, delay, and drift direction so the fall looks organic.
  const particles = useMemo(() =>
    Array.from({ length: 44 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 22 + Math.random() * 28,
      duration: 2.4 + Math.random() * 2,
      delay: Math.random() * 0.9,
      drift: (Math.random() - 0.5) * 140,
      rot: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    })),
    []
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
      <style>{`
        @keyframes bicep-fall {
          0%   { transform: translate(0, -20vh) rotate(0deg); opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translate(var(--bicep-drift, 0px), 115vh) rotate(var(--bicep-rot, 540deg)); opacity: 0; }
        }
      `}</style>
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute select-none"
          style={{
            left: `${p.left}vw`,
            top: 0,
            fontSize: `${p.size}px`,
            animation: `bicep-fall ${p.duration}s cubic-bezier(.25,.1,.4,1) ${p.delay}s forwards`,
            '--bicep-drift': `${p.drift}px`,
            '--bicep-rot': `${p.rot}deg`,
          }}
        >
          💪
        </div>
      ))}
    </div>
  );
};

// ============================================================
// Tiny SVG Chart Components - no external dependencies
// ============================================================

// Line chart for time-series progression. Data: [{ label, value }]
const LineChart = ({ data, height = 90, color = '#f97316', accent = '#fb923c', showDots = true, unit = '' }) => {
  if (!data || data.length === 0) return <div className="text-xs text-neutral-600 text-center py-4">No data yet</div>;
  if (data.length === 1) {
    return (
      <div className="text-center py-3">
        <div className="text-2xl font-mono font-bold text-orange-400">{data[0].value}{unit}</div>
        <div className="text-[9px] text-neutral-500 tracking-widest mt-1">SINGLE DATA POINT</div>
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = max - min || 1;
  const w = 320;
  const h = height;
  const pad = 14;
  const xStep = (w - pad * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = pad + i * xStep;
    const y = h - pad - ((d.value - min) / range) * (h - pad * 2);
    return { x, y, value: d.value, label: d.label };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  // Area fill gradient
  const areaPath = `${path} L ${points[points.length - 1].x.toFixed(1)} ${h - pad} L ${points[0].x.toFixed(1)} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`lc-grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#lc-grad-${color.replace('#', '')})`} />
      <path d={path} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {showDots && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? '#fff' : color} stroke={color} strokeWidth={i === points.length - 1 ? 2 : 0} />
      ))}
    </svg>
  );
};

// Vertical bar chart. Data: [{ label, value }]
const BarChart = ({ data, height = 90, color = '#f97316' }) => {
  if (!data || data.length === 0) return <div className="text-xs text-neutral-600 text-center py-4">No data yet</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 320;
  const h = height;
  const pad = 14;
  const barW = (w - pad * 2) / data.length - 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {data.map((d, i) => {
        const bh = ((d.value / max) * (h - pad * 2));
        const x = pad + i * ((w - pad * 2) / data.length) + 2;
        const y = h - pad - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} fill={color} rx="2" />
            <text x={x + barW / 2} y={h - 3} fontSize="8" fill="#737373" textAnchor="middle" fontFamily="monospace">{d.label}</text>
            {d.value > 0 && <text x={x + barW / 2} y={y - 3} fontSize="9" fill="#fff" textAnchor="middle" fontFamily="monospace" fontWeight="bold">{d.value}</text>}
          </g>
        );
      })}
    </svg>
  );
};

// Scatter plot for recovery vs performance
const ScatterPlot = ({ data, height = 140, xLabel = 'Recovery %', yLabel = 'TUT' }) => {
  if (!data || data.length < 2) return <div className="text-xs text-neutral-600 text-center py-6">Need at least 2 sessions with WHOOP recovery logged</div>;
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs); const xMax = Math.max(...xs);
  const yMin = Math.min(...ys); const yMax = Math.max(...ys);
  const xRange = (xMax - xMin) || 1;
  const yRange = (yMax - yMin) || 1;
  const w = 320;
  const h = height;
  const pad = 24;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {/* axes */}
      <line x1={pad} y1={h - pad} x2={w - 4} y2={h - pad} stroke="#404040" strokeWidth="1" />
      <line x1={pad} y1={4} x2={pad} y2={h - pad} stroke="#404040" strokeWidth="1" />
      {/* points */}
      {data.map((d, i) => {
        const x = pad + ((d.x - xMin) / xRange) * (w - pad - 8);
        const y = (h - pad) - ((d.y - yMin) / yRange) * (h - pad - 8);
        return <circle key={i} cx={x} cy={y} r="4" fill="#f97316" opacity="0.8" />;
      })}
      <text x={pad} y={h - 4} fontSize="8" fill="#737373" fontFamily="monospace">{xLabel}</text>
      <text x={4} y={12} fontSize="8" fill="#737373" fontFamily="monospace">{yLabel}</text>
    </svg>
  );
};

// Metric card showing value + delta arrow vs previous
const MetricCard = ({ label, value, subunit, prev, current, unit = '' }) => {
  let deltaEl = null;
  if (prev !== null && prev !== undefined && current !== null && current !== undefined && !isNaN(prev) && !isNaN(current)) {
    const diff = current - prev;
    if (Math.abs(diff) > 0.05) {
      const up = diff > 0;
      const absDiff = Math.abs(diff);
      const formatted = absDiff < 10 ? absDiff.toFixed(1) : Math.round(absDiff);
      deltaEl = (
        <div className={`text-[10px] font-mono font-semibold ${up ? 'text-green-400' : 'text-orange-400'}`}>
          {up ? '↑' : '↓'}{formatted}{unit}
        </div>
      );
    } else {
      deltaEl = <div className="text-[10px] font-mono font-semibold text-neutral-500">=</div>;
    }
  }
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
      <div className="flex items-start justify-between mb-1">
        <div className="text-[9px] tracking-[0.2em] text-neutral-500 uppercase font-semibold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>{label}</div>
        {deltaEl}
      </div>
      <div className="flex items-baseline gap-1">
        <div className="text-2xl text-white font-bold font-mono leading-none">{value}</div>
        {subunit && <div className="text-[10px] text-neutral-500 font-mono">{subunit}</div>}
      </div>
    </div>
  );
};

// ============================================================
// Post-Save Summary Screen - shows right after confetti
// ============================================================
const SessionSummary = ({ justSaved, previousSameProgramme, allSessions, onContinue }) => {
  const tut = sessionTUT(justSaved);
  const prevTUT = previousSameProgramme ? sessionTUT(previousSameProgramme) : null;
  const tonnage = sessionTonnage(justSaved);
  const prevTonnage = previousSameProgramme ? sessionTonnage(previousSameProgramme) : null;
  const sets = sessionSetCount(justSaved);
  const prevSets = previousSameProgramme ? sessionSetCount(previousSameProgramme) : null;
  const avgTime = sessionAvgSetTime(justSaved);
  const prevAvg = previousSameProgramme ? sessionAvgSetTime(previousSameProgramme) : null;
  const reps = sessionTotalReps(justSaved);
  const prevReps = previousSameProgramme ? sessionTotalReps(previousSameProgramme) : null;
  // Number of exercises actually trained (included AND had at least one logged set)
  const exerciseCountFor = (s) => (s?.exercises || [])
    .filter((ex) => ex.included !== false)
    .filter((ex) => (ex.sets || []).some((st) => (Number(st.time) || 0) > 0 || (Number(st.reps) || 0) > 0 || (Number(st.weight) || 0) > 0))
    .length;
  const exerciseCount = exerciseCountFor(justSaved);
  const prevExerciseCount = previousSameProgramme ? exerciseCountFor(previousSameProgramme) : null;

  const prs = detectPRs(justSaved, allSessions);
  const highlights = generateHighlights(justSaved, previousSameProgramme);
  const programmeName = (PROGRAMMES[justSaved.programme]?.label || justSaved.programme || 'Session').toUpperCase();
  const progression = computeProgressionScore(justSaved, previousSameProgramme);

  return (
    <div className="fixed inset-0 z-[9998] overflow-y-auto" style={{ backgroundColor: '#000000' }}>
      <div className="min-h-screen p-5 pb-8 flex flex-col max-w-md mx-auto">
        {/* Header */}
        <div className="pt-6 pb-5 text-center">
          <div className="text-[10px] tracking-[0.35em] text-orange-500 font-semibold uppercase mb-2" style={{ fontFamily: 'var(--font-display)' }}>{programmeName} COMPLETE</div>
          <div className="text-3xl font-bold text-white tracking-widest leading-none" style={{ fontFamily: 'var(--font-display)' }}>SESSION BANKED</div>
          {justSaved.durationMin && <div className="text-xs text-neutral-500 mt-3 font-mono">{justSaved.durationMin} min{justSaved.rating ? ` · rated ${justSaved.rating}/10` : ''}</div>}
        </div>

        {/* Headline progression score - the gross workout-vs-last delta */}
        {progression.score !== null && (
          <div className={`mb-4 rounded-xl p-4 border-2 ${
            progression.score > 0 ? 'bg-green-950/40 border-green-600' :
            progression.score < 0 ? 'bg-orange-950/40 border-orange-600' :
            'bg-neutral-950 border-neutral-800'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-4 h-4 ${progression.score > 0 ? 'text-green-400' : progression.score < 0 ? 'text-orange-400' : 'text-neutral-400'}`} />
              <span className="text-[10px] tracking-[0.3em] font-bold uppercase text-neutral-300" style={{ fontFamily: 'var(--font-display)' }}>Overall Progression</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`font-mono font-black text-4xl leading-none ${progression.score > 0 ? 'text-green-300' : progression.score < 0 ? 'text-orange-300' : 'text-neutral-300'}`}>
                {progression.score > 0 ? '+' : ''}{progression.score.toFixed(1)}%
              </span>
              <span className="text-[10px] tracking-widest text-neutral-500 font-mono">vs last {programmeName.toLowerCase()}</span>
            </div>
            <div className="text-[10px] text-neutral-500 mt-2 leading-relaxed">
              Combined weight × time across {progression.matched} matched exercise{progression.matched === 1 ? '' : 's'}. Heavier weight or longer hold both push this up.
            </div>
          </div>
        )}

        {/* Metric grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <MetricCard label="Time Under Tension" value={tut} subunit="s" prev={prevTUT} current={tut} unit="s" />
          <MetricCard label="Tonnage" value={Math.round(tonnage)} subunit="kg·s" prev={prevTonnage} current={tonnage} unit="" />
          <MetricCard label="Avg Set Time" value={avgTime.toFixed(1)} subunit="s" prev={prevAvg} current={avgTime} unit="s" />
          <MetricCard label="Sets Completed" value={sets} prev={prevSets} current={sets} unit="" />
          <MetricCard label="Exercises Trained" value={exerciseCount} prev={prevExerciseCount} current={exerciseCount} unit="" />
          {justSaved.whoopRecovery && <MetricCard label="WHOOP Recovery" value={justSaved.whoopRecovery} subunit="%" prev={previousSameProgramme?.whoopRecovery ? Number(previousSameProgramme.whoopRecovery) : null} current={Number(justSaved.whoopRecovery)} unit="%" />}
        </div>

        {/* PRs - now with weight values + delta vs prev session for the same exercise */}
        {prs.length > 0 && (
          <div className="mb-4 bg-amber-950/40 border-2 border-amber-600 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span className="text-xs tracking-[0.3em] text-amber-400 font-bold uppercase" style={{ fontFamily: 'var(--font-display)' }}>Personal Bests</span>
            </div>
            <div className="space-y-2">
              {prs.map((pr, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white text-sm truncate flex-1 min-w-0">{pr.exercise}</span>
                  <div className="flex items-center gap-1.5 shrink-0 text-xs font-mono">
                    <span className="text-amber-300/70">{pr.prev}{pr.unit}</span>
                    <span className="text-amber-500">→</span>
                    <span className="text-amber-200 font-bold">{pr.current}{pr.unit}</span>
                    <span className="text-green-400 font-bold ml-1">+{(pr.current - pr.prev)}{pr.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Highlights */}
        <div className="mb-4 bg-neutral-950 border border-neutral-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-orange-500" />
            <span className="text-[10px] tracking-[0.3em] text-neutral-400 font-bold uppercase" style={{ fontFamily: 'var(--font-display)' }}>Highlights</span>
          </div>
          <div className="space-y-2">
            {highlights.map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-neutral-200">
                <span className="text-orange-500 font-bold mt-0.5">→</span>
                <span className="leading-snug">{h}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Comparison note */}
        {previousSameProgramme ? (
          <div className="text-[10px] text-neutral-600 font-mono text-center mb-4 tracking-wide">
            vs {programmeName} on {new Date(previousSameProgramme.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </div>
        ) : (
          <div className="text-[10px] text-neutral-600 font-mono text-center mb-4 tracking-wide">FIRST SESSION OF THIS PROGRAMME</div>
        )}

        {/* Continue button */}
        <button
          onClick={onContinue}
          className="w-full h-14 bg-orange-500 text-black rounded-xl font-bold tracking-[0.25em] active:bg-orange-600 flex items-center justify-center gap-3"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          CONTINUE <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

// ============================================================
// Stats View - deep analytics across all sessions
// ============================================================
const StatsView = ({ sessions, onBack }) => {
  const [exMetric, setExMetric] = useState('weight'); // 'weight' | 'tut'
  const [expanded, setExpanded] = useState(new Set());
  const toggleExpanded = (name) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // Overview totals - kept lean and relevant
  const totals = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    let totalTUT = 0, totalReps = 0, totalSets = 0;
    sorted.forEach((s) => {
      totalTUT += sessionTUT(s);
      totalReps += sessionTotalReps(s);
      totalSets += sessionSetCount(s);
    });
    const weeks = new Set(sorted.map((s) => weekKey(s.date)).filter(Boolean));
    return { sessions: sorted.length, totalTUT, totalReps, totalSets, weeksTrained: weeks.size };
  }, [sessions]);

  // Programme split - count by raw programme key, treat anything else as untagged
  const programmeSplit = useMemo(() => {
    const counts = { anterior: 0, posterior: 0, untagged: 0 };
    sessions.forEach((s) => {
      if (s.programme === 'anterior') counts.anterior++;
      else if (s.programme === 'posterior') counts.posterior++;
      else counts.untagged++;
    });
    return counts;
  }, [sessions]);

  // Weekly frequency last 8 weeks
  const weeklyFreq = useMemo(() => {
    const now = new Date();
    const out = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const key = weekKey(d.toISOString());
      const count = sessions.filter((s) => weekKey(s.date) === key).length;
      out.push({ label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).split(' ')[0], value: count });
    }
    return out;
  }, [sessions]);

  // Rating distribution
  const ratingDist = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: 0 }));
    sessions.forEach((s) => {
      const r = Number(s.rating);
      if (r >= 1 && r <= 10) buckets[r - 1].value++;
    });
    return buckets;
  }, [sessions]);

  // Per-exercise progression - the headline data set
  // For each exercise, builds an array of session-level stats (max weight, total TUT)
  // chronologically, so we can plot weight progression and TUT trend.
  const exerciseProgression = useMemo(() => {
    const map = new Map();
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((s) => {
      (s.exercises || []).filter((ex) => ex.included !== false).forEach((ex) => {
        if (!map.has(ex.name)) map.set(ex.name, { unit: ex.unit, points: [] });
        const sets = (ex.sets || []);
        const tut = sets.reduce((sum, set) => sum + (Number(set.time) || 0), 0);
        const maxWeight = Math.max(0, ...sets.map((st) => Number(st.weight) || 0));
        const avgWeight = (() => {
          const ws = sets.map((st) => Number(st.weight) || 0).filter((w) => w > 0);
          return ws.length ? ws.reduce((a, w) => a + w, 0) / ws.length : 0;
        })();
        // Skip if this session had no real data for this exercise
        if (tut === 0 && maxWeight === 0) return;
        map.get(ex.name).points.push({
          label: new Date(s.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          tut,
          maxWeight,
          avgWeight,
          date: s.date,
          programme: s.programme,
        });
      });
    });
    // Return ordered: bodyweight last, then by number of sessions desc
    return Array.from(map.entries())
      .filter(([, v]) => v.points.length >= 1)
      .sort((a, b) => {
        if ((a[1].unit === 'bw') !== (b[1].unit === 'bw')) return a[1].unit === 'bw' ? 1 : -1;
        return b[1].points.length - a[1].points.length;
      });
  }, [sessions]);

  // Personal bests across all exercises
  const personalBests = useMemo(() => {
    // Walk sessions in chronological order. For each exercise, track the running PB
    // and the previous PB before the latest one was set, so we can show the delta.
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const bests = new Map();
    sorted.forEach((s) => {
      (s.exercises || []).filter((ex) => ex.included !== false).forEach((ex) => {
        if (!bests.has(ex.name)) {
          bests.set(ex.name, {
            // For each metric: current best AND the previous best before that
            weight: { val: 0, date: null, prevVal: 0, prevDate: null },
            time: { val: 0, date: null, prevVal: 0, prevDate: null },
            reps: { val: 0, date: null, prevVal: 0, prevDate: null },
            unit: ex.unit,
          });
        }
        const best = bests.get(ex.name);
        (ex.sets || []).forEach((set) => {
          const w = Number(set.weight) || 0;
          const t = Number(set.time) || 0;
          const r = Number(set.reps) || 0;
          if (w > best.weight.val) {
            best.weight = { val: w, date: s.date, prevVal: best.weight.val, prevDate: best.weight.date };
          }
          if (t > best.time.val) {
            best.time = { val: t, date: s.date, prevVal: best.time.val, prevDate: best.time.date };
          }
          if (r > best.reps.val) {
            best.reps = { val: r, date: s.date, prevVal: best.reps.val, prevDate: best.reps.date };
          }
        });
      });
    });
    return Array.from(bests.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);

  // WHOOP recovery vs TUT scatter
  const recoveryScatter = useMemo(() => {
    return sessions
      .filter((s) => s.whoopRecovery && !isNaN(Number(s.whoopRecovery)))
      .map((s) => ({ x: Number(s.whoopRecovery), y: sessionTUT(s) }));
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="min-h-screen bg-black text-white p-5">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={onBack} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl tracking-widest" style={{ fontFamily: 'var(--font-display)' }}>STATS</h1>
        </div>
        <div className="text-center py-20">
          <BarChart3 className="w-12 h-12 text-neutral-700 mx-auto mb-3" />
          <div className="text-neutral-500">No sessions logged yet.</div>
          <div className="text-xs text-neutral-600 mt-2">Stats will appear after your first save.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black border-b border-neutral-900 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl tracking-widest leading-none" style={{ fontFamily: 'var(--font-display)' }}>STATS</h1>
          <div className="text-[9px] tracking-widest text-neutral-500 mt-0.5">{totals.sessions} session{totals.sessions === 1 ? '' : 's'} · {totals.weeksTrained} week{totals.weeksTrained === 1 ? '' : 's'} trained</div>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-md mx-auto">

        {/* ============================================== */}
        {/* HEADLINE: Per-exercise progression - the No.1 stat */}
        {/* ============================================== */}
        {exerciseProgression.length > 0 && (
          <section>
            <SectionTitle icon={<TrendingUp className="w-3.5 h-3.5" />}>EXERCISE PROGRESSION</SectionTitle>
            <div className="text-[10px] text-neutral-500 mb-3 font-mono leading-relaxed">
              Tap an exercise for its full chart. Toggle WEIGHT vs TIME UNDER TENSION to switch view.
            </div>
            {/* Metric toggle - only weight and TUT (the two metrics that matter) */}
            <div className="flex gap-1 mb-3 bg-neutral-900 p-1 rounded-lg">
              {[{ k: 'weight', label: 'WEIGHT' }, { k: 'tut', label: 'TIME UNDER TENSION' }].map((m) => (
                <button
                  key={m.k}
                  onClick={() => setExMetric(m.k)}
                  className={`flex-1 h-9 rounded-md text-[10px] tracking-widest font-bold ${exMetric === m.k ? 'bg-orange-500 text-black' : 'text-neutral-400'}`}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {exerciseProgression.map(([name, data]) => {
                const isOpen = expanded.has(name);
                const points = data.points;
                const isBW = data.unit === 'bw';
                const metricKey = exMetric === 'tut' ? 'tut' : 'maxWeight';
                const unit = exMetric === 'tut' ? 's' : 'kg';
                // Skip weight progression for bodyweight exercises (always 0)
                if (exMetric === 'weight' && isBW) {
                  return (
                    <div key={name} className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 opacity-50">
                      <div className="text-sm font-semibold text-white truncate">{name}</div>
                      <div className="text-[10px] text-neutral-600 font-mono mt-0.5">Bodyweight exercise · no weight progression</div>
                    </div>
                  );
                }
                const latest = points[points.length - 1];
                const first = points[0];
                const chartData = points.map((p) => ({ label: p.label, value: p[metricKey] }));
                const deltaVal = points.length >= 2 ? latest[metricKey] - first[metricKey] : 0;
                const sessionsCount = points.length;
                return (
                  <div key={name} className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden">
                    <button onClick={() => toggleExpanded(name)} className="w-full p-3 flex items-center justify-between text-left active:bg-neutral-900">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="text-sm font-semibold text-white truncate">{name}</div>
                        <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                          {sessionsCount} session{sessionsCount === 1 ? '' : 's'} · latest <span className="text-orange-400 font-bold">{latest[metricKey]}{unit}</span>
                          {sessionsCount >= 2 && first[metricKey] > 0 && <span> · started {first[metricKey]}{unit}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {sessionsCount >= 2 && (
                          <span className={`text-[11px] font-mono font-bold ${deltaVal > 0 ? 'text-green-400' : deltaVal < 0 ? 'text-orange-400' : 'text-neutral-500'}`}>
                            {deltaVal > 0 ? '↑' : deltaVal < 0 ? '↓' : '='}{Math.abs(Math.round(deltaVal))}{unit}
                          </span>
                        )}
                        <span className="text-neutral-600 text-xs">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-neutral-900 p-3">
                        {sessionsCount >= 2 ? (
                          <LineChart data={chartData} height={120} unit={unit} />
                        ) : (
                          <div className="text-center py-3">
                            <div className="text-2xl font-mono font-bold text-orange-400">{latest[metricKey]}{unit}</div>
                            <div className="text-[9px] text-neutral-600 tracking-widest mt-1">Log another session to see a trend</div>
                          </div>
                        )}
                        {/* Sessions table mini-summary - max weight & TUT side-by-side */}
                        {sessionsCount >= 2 && (
                          <div className="mt-3 pt-3 border-t border-neutral-900 grid grid-cols-2 gap-2 text-[10px] font-mono">
                            <div className="bg-neutral-900 rounded p-2">
                              <div className="text-neutral-500 text-[9px] tracking-widest">PEAK WEIGHT</div>
                              <div className="text-amber-400 font-bold text-sm mt-0.5">{Math.max(...points.map(p => p.maxWeight))}kg</div>
                            </div>
                            <div className="bg-neutral-900 rounded p-2">
                              <div className="text-neutral-500 text-[9px] tracking-widest">PEAK TUT (sess.)</div>
                              <div className="text-sky-400 font-bold text-sm mt-0.5">{Math.max(...points.map(p => p.tut))}s</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Personal bests - shows current PB AND increase vs previous PB so progression is visible */}
        {personalBests.length > 0 && (
          <section>
            <SectionTitle icon={<Trophy className="w-3.5 h-3.5" />}>PERSONAL BESTS</SectionTitle>
            <div className="text-[10px] text-neutral-500 mb-2 font-mono leading-relaxed">
              Current best per exercise. Delta shows the gain from the previous PB. Goal: heavier weight + longer TUT.
            </div>
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-900">
              {personalBests.map(([name, best]) => {
                const wDelta = best.weight.prevVal > 0 ? best.weight.val - best.weight.prevVal : null;
                const tDelta = best.time.prevVal > 0 ? best.time.val - best.time.prevVal : null;
                const rDelta = best.reps.prevVal > 0 ? best.reps.val - best.reps.prevVal : null;
                return (
                  <div key={name} className="p-3">
                    <div className="text-sm font-semibold text-white mb-2 truncate">{name}</div>
                    <div className="space-y-1.5">
                      {best.weight.val > 0 && best.unit !== 'bw' && (
                        <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono">
                          <span className="text-neutral-500 tracking-widest">PEAK WEIGHT</span>
                          <span className="flex items-baseline gap-1.5 shrink-0">
                            <span className="text-amber-400 font-bold text-sm">{best.weight.val}kg</span>
                            {wDelta !== null && wDelta > 0 ? (
                              <span className="text-green-400 font-bold">+{wDelta}kg vs {best.weight.prevVal}kg</span>
                            ) : best.weight.prevVal === 0 ? (
                              <span className="text-neutral-600">first record</span>
                            ) : null}
                            <span className="text-neutral-600 ml-1">{new Date(best.weight.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                          </span>
                        </div>
                      )}
                      {best.time.val > 0 && (
                        <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono">
                          <span className="text-neutral-500 tracking-widest">PEAK TUT</span>
                          <span className="flex items-baseline gap-1.5 shrink-0">
                            <span className="text-sky-400 font-bold text-sm">{best.time.val}s</span>
                            {tDelta !== null && tDelta > 0 ? (
                              <span className="text-green-400 font-bold">+{tDelta}s vs {best.time.prevVal}s</span>
                            ) : best.time.prevVal === 0 ? (
                              <span className="text-neutral-600">first record</span>
                            ) : null}
                            <span className="text-neutral-600 ml-1">{new Date(best.time.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                          </span>
                        </div>
                      )}
                      {best.reps.val > 0 && best.unit === 'bw' && (
                        <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono">
                          <span className="text-neutral-500 tracking-widest">PEAK REPS</span>
                          <span className="flex items-baseline gap-1.5 shrink-0">
                            <span className="text-green-400 font-bold text-sm">{best.reps.val}</span>
                            {rDelta !== null && rDelta > 0 ? (
                              <span className="text-green-400 font-bold">+{rDelta} vs {best.reps.prevVal}</span>
                            ) : best.reps.prevVal === 0 ? (
                              <span className="text-neutral-600">first record</span>
                            ) : null}
                            <span className="text-neutral-600 ml-1">{new Date(best.reps.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ============================================== */}
        {/* SECONDARY: Activity overview, split, freq, rating */}
        {/* ============================================== */}

        {/* Activity overview - relevant counters only */}
        <section>
          <SectionTitle icon={<Target className="w-3.5 h-3.5" />}>ACTIVITY OVERVIEW</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard label="Sessions" value={totals.sessions} />
            <MetricCard label="Total TUT" value={`${Math.round(totals.totalTUT / 60)}`} subunit="min" />
            <MetricCard label="Working Sets" value={totals.totalSets} />
            <MetricCard label="Weeks Trained" value={totals.weeksTrained} />
          </div>
        </section>

        {/* Programme split */}
        <section>
          <SectionTitle icon={<Dumbbell className="w-3.5 h-3.5" />}>PROGRAMME SPLIT</SectionTitle>
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4">
            {(() => {
              const total = programmeSplit.anterior + programmeSplit.posterior + programmeSplit.untagged;
              if (total === 0) return <div className="text-xs text-neutral-600 text-center py-2">No programme data</div>;
              const antPct = (programmeSplit.anterior / total) * 100;
              const postPct = (programmeSplit.posterior / total) * 100;
              const untaggedPct = (programmeSplit.untagged / total) * 100;
              return (
                <>
                  <div className="flex h-8 rounded overflow-hidden mb-3">
                    {antPct > 0 && <div style={{ width: `${antPct}%` }} className="bg-orange-500 flex items-center justify-center text-[10px] text-black font-bold">{programmeSplit.anterior}</div>}
                    {postPct > 0 && <div style={{ width: `${postPct}%` }} className="bg-green-500 flex items-center justify-center text-[10px] text-black font-bold">{programmeSplit.posterior}</div>}
                    {untaggedPct > 0 && <div style={{ width: `${untaggedPct}%` }} className="bg-neutral-700 flex items-center justify-center text-[10px] text-black font-bold">{programmeSplit.untagged}</div>}
                  </div>
                  <div className="flex items-center justify-between text-[10px] tracking-widest font-mono flex-wrap gap-y-1">
                    <span className="text-orange-400">ANTERIOR {antPct.toFixed(0)}%</span>
                    <span className="text-green-400">POSTERIOR {postPct.toFixed(0)}%</span>
                    {programmeSplit.untagged > 0 && <span className="text-neutral-500">UNTAGGED {untaggedPct.toFixed(0)}%</span>}
                  </div>
                  {programmeSplit.untagged > 0 && (
                    <div className="mt-3 pt-3 border-t border-neutral-900 text-[10px] text-neutral-500 leading-relaxed">
                      <span className="text-amber-500 font-bold">{programmeSplit.untagged}</span> session{programmeSplit.untagged === 1 ? '' : 's'} not tagged. Open from History and use the programme selector to assign one.
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </section>

        {/* Weekly frequency */}
        <section>
          <SectionTitle icon={<BarChart3 className="w-3.5 h-3.5" />}>WEEKLY FREQUENCY · LAST 8 WEEKS</SectionTitle>
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
            <BarChart data={weeklyFreq} height={110} />
          </div>
        </section>

        {/* Rating distribution */}
        {sessions.some((s) => s.rating) && (
          <section>
            <SectionTitle icon={<Flame className="w-3.5 h-3.5" />}>WORKOUT RATING DISTRIBUTION</SectionTitle>
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
              <BarChart data={ratingDist} height={90} />
            </div>
          </section>
        )}

        {/* WHOOP recovery vs performance (TUT) scatter */}
        {recoveryScatter.length >= 2 && (
          <section>
            <SectionTitle icon={<Zap className="w-3.5 h-3.5" />}>RECOVERY vs PERFORMANCE</SectionTitle>
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
              <ScatterPlot data={recoveryScatter} height={160} xLabel="Recovery %" yLabel="Session TUT" />
              <div className="text-[9px] text-neutral-500 mt-1 text-center tracking-widest font-mono">{recoveryScatter.length} data points</div>
            </div>
          </section>
        )}

        <div className="text-center text-[9px] text-neutral-700 tracking-widest font-mono pt-4">END OF STATS</div>
      </div>
    </div>
  );
};

// Small helper for stats section titles
const SectionTitle = ({ children, icon, mb = 'mb-2' }) => (
  <div className={`flex items-center gap-2 ${mb}`}>
    {icon && <span className="text-orange-500">{icon}</span>}
    <h2 className="text-[10px] tracking-[0.3em] text-neutral-400 font-bold uppercase" style={{ fontFamily: 'var(--font-display)' }}>{children}</h2>
  </div>
);

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [view, setView] = useState('log'); // 'log' | 'history' | 'stats'
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [editingSet, setEditingSet] = useState(null); // {exerciseIdx, setIdx, warmup?}
  const [loading, setLoading] = useState(true);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  // Tracks the most recently auto-filled set/warmup so the rest timer can display it as "last logged"
  const [lastLogged, setLastLogged] = useState(null); // { exercise, isWarmup, setNumber, time, weight, reps, bw, prevTime, prevWeight }
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [summaryData, setSummaryData] = useState(null); // { justSaved, previousSameProgramme } when summary should show
  const [editingExistingId, setEditingExistingId] = useState(null); // set when loading a past session to edit

  // Helper: build an "included" flags map from most recent session of same programme
  const buildIncludedMap = (sessionsList, programme) => {
    const relevant = sessionsList.find((s) => s.programme === programme);
    if (!relevant) return null;
    const map = {};
    (relevant.exercises || []).forEach((ex) => {
      map[ex.name] = ex.included !== false;
    });
    return map;
  };

  // Helper: build a per-exercise "last session counts" map from the most recent same-programme
  // session. Used to inherit working-set count and warmup count so the new session's layout
  // mirrors what was actually done last time, regardless of the static defaults.
  const buildLastCountsMap = (sessionsList, programme) => {
    const sorted = [...sessionsList]
      .filter((s) => s.programme === programme)
      .sort((a, b) => {
        // Compare normalised date strings (YYYY-MM-DD) for max reliability
        const dateA = String(a.date || '').slice(0, 10);
        const dateB = String(b.date || '').slice(0, 10);
        if (dateB !== dateA) return dateB > dateA ? 1 : -1;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    const last = sorted[0];
    if (!last) return null;
    const map = {};
    // Count only sets that had real data logged. Empty trailing sets in the prior
    // session must NOT propagate into the new session, otherwise we get cells
    // with no suggested values dangling at the end.
    const hasData = (st) => {
      const r = parseInt(st.reps);
      const w = parseFloat(st.weight);
      const t = parseFloat(st.time);
      return (st.bw === true) || (st.failure === true) || (Number.isFinite(r) && r > 0) || (Number.isFinite(w) && w > 0) || (Number.isFinite(t) && t > 0);
    };
    (last.exercises || []).forEach((ex) => {
      const setsLogged = (ex.sets || []).filter(hasData).length;
      const warmupsLogged = (ex.warmupSets || []).filter(hasData).length;
      map[ex.name] = {
        sets: setsLogged,
        warmups: warmupsLogged,
      };
    });
    return map;
  };

  // Helper: build a new session for a given programme, pulling in last-time's included flags
  // and any custom exercises that were part of that last session (so user's additions carry over)
  const buildSessionForProgramme = async (programme, sessionsList) => {
    const base = PROGRAMMES[programme]?.exercises || PROGRAMMES.anterior.exercises;
    const storedTemplate = await storage.getTemplate(programme);
    const template = storedTemplate || base;
    const includedMap = buildIncludedMap(sessionsList, programme);
    const lastCounts = buildLastCountsMap(sessionsList, programme);
    return createEmptySession(template, programme, includedMap, lastCounts);
  };

  // Load initial data
  useEffect(() => {
    (async () => {
      // Run one-time migration to clear stale stored templates from the ANT/POS swap
      await storage.runSwapMigration();
      const all = await storage.listSessions();
      setSessions(all);
      const draft = await storage.getDraft();
      if (draft) {
        // Ensure draft has a programme field (migrate older drafts)
        if (!draft.programme) draft.programme = 'anterior';
        setSession(draft);
      } else {
        // Default new session: anterior, with last anterior session's included flags
        const next = await buildSessionForProgramme('anterior', all);
        setSession(next);
      }
      setLoading(false);
    })();
  }, []);

  // App-wide Screen Wake Lock - keeps the phone awake any time the app is open and visible.
  // iOS Safari supports this from 16.4+ in tabs and from 18.4+ in installed home-screen PWAs.
  // The OS auto-releases the lock if the user backgrounds the app, locks the phone, or the
  // tab is hidden, so we re-acquire on every visibility change back to "visible".
  useEffect(() => {
    let wakeLock = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled) return;
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
      if (document.visibilityState !== 'visible') return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        // If the OS releases the lock for any reason while we're still visible,
        // try to take it again immediately so the screen stays on.
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
          if (!cancelled && document.visibilityState === 'visible') {
            // Slight defer to avoid tight loops on a system-imposed release
            setTimeout(acquire, 250);
          }
        });
      } catch (e) {
        // Common rejections: low battery, OS power-saving, no support. Silently ignore.
      }
    };

    const release = () => {
      if (wakeLock) {
        try { wakeLock.release(); } catch (_) {}
        wakeLock = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquire();
      } else {
        release();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    // Some browsers also need pageshow when restoring from bfcache
    window.addEventListener('pageshow', onVisibility);
    acquire();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      release();
    };
  }, []);

  // Auto-save draft (skip when editing a past session so we don't overwrite the live draft)
  useEffect(() => {
    if (session && !loading && !editingExistingId) {
      const t = setTimeout(() => storage.setDraft(session), 400);
      return () => clearTimeout(t);
    }
  }, [session, loading, editingExistingId]);

  // Build a map of exercise name -> most recent previous SAME-PROGRAMME session stats for that exercise.
  // Only considers "included" exercises, ignores warmup data in averages.
  // Filtering by matching programme ensures anterior days compare against anterior days,
  // posterior against posterior, never mixing them.
  const previousByExercise = useMemo(() => {
    const map = {};
    const currentProgramme = session?.programme;
    // Only exclude the loaded session if we're actively editing an existing one. For fresh
    // drafts we never exclude (drafts shouldn't accidentally hide saved data even if their ids collide).
    const excludeId = editingExistingId || null;
    // Filter to same-programme sessions, sort newest first by date string (YYYY-MM-DD lexicographic works)
    const pool = sessions
      .filter((s) => !excludeId || s.id !== excludeId)
      .filter((s) => !currentProgramme || s.programme === currentProgramme)
      .sort((a, b) => {
        const dateA = String(a.date || '').slice(0, 10);
        const dateB = String(b.date || '').slice(0, 10);
        if (dateB !== dateA) return dateB > dateA ? 1 : -1;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    for (const s of pool) {
      for (const ex of s.exercises || []) {
        if (map[ex.name]) continue;
        // Skip if exercise was explicitly excluded in that session
        if (ex.included === false) continue;
        const isBW = ex.unit === 'bw';
        // Skip warmup sets in all stats
        const workingSets = (ex.sets || []).filter((st) => !st.warmup);
        const withTime = workingSets.filter((st) => st.time !== '' && parseFloat(st.time) > 0);
        const withReps = workingSets.filter((st) => st.reps !== '' && parseInt(st.reps) > 0);
        const withWeight = workingSets.filter((st) => !isBW && !st.bw && st.weight !== '');
        // Only record if this session actually had data logged for this exercise
        if (withTime.length === 0 && withReps.length === 0 && withWeight.length === 0) continue;
        // Trim trailing empty sets so the new session does not inherit phantom blank cells
        const setHasData = (st) => {
          const r = parseInt(st.reps);
          const w = parseFloat(st.weight);
          const t = parseFloat(st.time);
          return (st.bw === true) || (st.failure === true) || (Number.isFinite(r) && r > 0) || (Number.isFinite(w) && w > 0) || (Number.isFinite(t) && t > 0);
        };
        const trimTrailing = (arr) => {
          let end = arr.length;
          while (end > 0 && !setHasData(arr[end - 1])) end--;
          return arr.slice(0, end);
        };
        const trimmedWorking = trimTrailing(workingSets);
        const trimmedWarmups = trimTrailing(ex.warmupSets || []);
        const map_entry = {
          date: s.date,
          avgTime: withTime.length > 0 ? withTime.reduce((a, st) => a + parseFloat(st.time), 0) / withTime.length : null,
          avgWeight: withWeight.length > 0 ? withWeight.reduce((a, st) => a + parseFloat(st.weight), 0) / withWeight.length : null,
          totalReps: withReps.length > 0 ? withReps.reduce((a, st) => a + parseInt(st.reps), 0) : null,
          sets: trimmedWorking.length,
          setData: trimmedWorking.map((st) => ({
            time: st.time,
            weight: st.weight,
            reps: st.reps,
            bw: st.bw,
            failure: st.failure,
          })),
          // Warmup data from the same exercise on that prior session, kept separately.
          // Used to pre-fill suggested reps/weight on warmup cells of new sessions.
          warmupSetData: trimmedWarmups.map((st) => ({
            weight: st.weight,
            reps: st.reps,
            bw: st.bw,
          })),
        };
        map[ex.name] = map_entry;
      }
    }
    return map;
  }, [sessions, editingExistingId, session?.programme]);

  const updateSession = (patch) => setSession((s) => ({ ...s, ...patch }));

  const updateExercise = (idx, newEx) => {
    setSession((s) => ({
      ...s,
      exercises: s.exercises.map((e, i) => i === idx ? newEx : e),
    }));
  };

  const toggleIncluded = (idx) => {
    setSession((s) => ({
      ...s,
      exercises: s.exercises.map((e, i) =>
        i === idx ? { ...e, included: e.included === false ? true : false } : e
      ),
    }));
  };

  const addWarmup = (idx) => {
    setSession((s) => ({
      ...s,
      exercises: s.exercises.map((e, i) =>
        i === idx ? { ...e, warmupSets: [...(e.warmupSets || []), emptyWarmup()] } : e
      ),
    }));
  };

  const removeWarmup = (idx) => {
    setSession((s) => ({
      ...s,
      exercises: s.exercises.map((e, i) =>
        i === idx ? { ...e, warmupSets: (e.warmupSets || []).slice(0, -1) } : e
      ),
    }));
  };

  const addExercise = () => {
    setSession((s) => ({
      ...s,
      exercises: [...s.exercises, { name: 'New Exercise', unit: 'kg', superset: false, included: true, warmupSets: [], sets: emptySets(3) }],
    }));
  };

  const deleteExercise = (idx) => {
    if (!confirm('Remove this exercise?')) return;
    setSession((s) => ({ ...s, exercises: s.exercises.filter((_, i) => i !== idx) }));
  };

  const saveCurrentSession = async () => {
    setShowSaveConfirm(false);
    // Stamp id/date if missing so summary/detectPRs can identify it
    const toSave = { ...session };
    if (!toSave.id) toSave.id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (!toSave.date) toSave.date = new Date().toISOString().slice(0, 10);
    // Normalise existing dates to YYYY-MM-DD so all sessions sort consistently regardless of when they were saved
    if (toSave.date && toSave.date.length > 10) toSave.date = toSave.date.slice(0, 10);
    await storage.saveSession(toSave);
    const all = await storage.listSessions();
    setSessions(all);

    // EDIT MODE: overwrite the existing session and return to history without celebration
    if (editingExistingId) {
      setEditingExistingId(null);
      // Restore the live draft so the next new session isn't blank
      const draft = await storage.getDraft();
      if (draft) {
        if (!draft.programme) draft.programme = 'anterior';
        setSession(draft);
      } else {
        const next = await buildSessionForProgramme(toSave.programme || 'anterior', all);
        setSession(next);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      setView('history');
      return;
    }

    // NEW SESSION: normal save flow with confetti, summary, next-session load
    await storage.clearDraft();
    // Save template from current exercise list, per-programme
    const template = toSave.exercises.map((e) => ({
      name: e.name, unit: e.unit, sets: e.sets.length, superset: e.superset,
    }));
    const programme = toSave.programme || 'anterior';
    await storage.setTemplate(template, programme);
    // Find previous same-programme session for comparison (excluding the one we just saved)
    const previousSameProgramme = findPreviousSameProgramme(all, toSave);
    // Next session defaults to same programme but user can switch
    const next = await buildSessionForProgramme(programme, all);
    setSession(next);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
    // Bicep confetti celebration
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 4500);
    // Show post-save summary after a short beat so confetti is visible first
    setTimeout(() => setSummaryData({ justSaved: toSave, previousSameProgramme, allSessions: all }), 400);
  };

  const openHistorySession = (s) => {
    setSession(s);
    setEditingExistingId(s.id);
    setView('log');
  };

  // Exit edit mode without saving: restore the live draft (or fresh session) and go back to history
  const cancelEdit = async () => {
    setEditingExistingId(null);
    const draft = await storage.getDraft();
    if (draft) {
      if (!draft.programme) draft.programme = 'anterior';
      setSession(draft);
    } else {
      const all = await storage.listSessions();
      const next = await buildSessionForProgramme('anterior', all);
      setSession(next);
    }
    setView('history');
  };

  const deleteHistorySession = async (id) => {
    await storage.deleteSession(id);
    const all = await storage.listSessions();
    setSessions(all);
  };

  const resetSession = async () => {
    if (!confirm('Start a new blank session? Current unsaved entries will be lost.')) return;
    const programme = session?.programme || 'anterior';
    await storage.clearDraft();
    const next = await buildSessionForProgramme(programme, sessions);
    setSession(next);
  };

  const switchProgramme = async (newProgramme) => {
    if (newProgramme === session?.programme) {
      // Tapping the same programme: in edit mode do nothing, otherwise offer a fresh reset
      if (editingExistingId) return;
      if (!confirm(`Reset ${PROGRAMMES[newProgramme].label} day to a fresh session? Current unsaved data will be lost.`)) return;
      await storage.clearDraft();
      const next = await buildSessionForProgramme(newProgramme, sessions);
      setSession(next);
      return;
    }
    // EDIT MODE: just re-tag the session's programme, never touch the exercise list.
    // This is how you fix a past session that was logged under the wrong programme.
    if (editingExistingId) {
      if (!confirm(`Re-tag this session as ${PROGRAMMES[newProgramme].label}?\n\nExercise data will be kept exactly as logged. You must tap SAVE CHANGES at the bottom to make this stick.`)) return;
      setSession((s) => ({ ...s, programme: newProgramme }));
      return;
    }
    // NEW SESSION: replacing the exercise list is the right behaviour
    const hasData = session?.exercises?.some((ex) =>
      ex.sets?.some((s) => s.reps || s.weight || s.time) ||
      (ex.warmupSets || []).some((s) => s.reps || s.weight)
    );
    if (hasData) {
      if (!confirm(`Switch to ${PROGRAMMES[newProgramme].label}? Current session data will be discarded.`)) return;
    }
    await storage.clearDraft();
    const next = await buildSessionForProgramme(newProgramme, sessions);
    setSession(next);
  };

  // --- Timer stop callback: auto-fill next empty slot (warmup OR working set) in natural order ---
  // Subtracts 3 seconds to compensate for the delay between set completion and tapping stop.
  // Walks exercises top-to-bottom, and for each one fills warmups first, then working sets.
  const handleTimerStop = (elapsedSeconds) => {
    const adjusted = Math.max(1, elapsedSeconds - 3);
    let toLog = null; // captured in the updater for setLastLogged after
    setSession((s) => {
      if (!s) return s;
      const exercises = [...s.exercises];
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        if (ex.included === false) continue;
        const isBW = ex.unit === 'bw';
        const prev = previousByExercise[ex.name];

        // First: try to fill an empty warmup slot for this exercise
        const warmups = ex.warmupSets || [];
        const emptyWarmupIdx = warmups.findIndex((st) => st.time === '' || st.time === undefined || st.time === null);
        const anyWorkingStarted = (ex.sets || []).some((st) => (st.time !== '' && st.time !== undefined && st.time !== null) || (st.reps !== '' && st.reps !== undefined && st.reps !== null) || st.failure);
        if (emptyWarmupIdx !== -1 && !anyWorkingStarted) {
          const prevW = prev?.warmupSetData?.[emptyWarmupIdx];
          const newW = { ...warmups[emptyWarmupIdx], time: adjusted };
          if (!isBW && !newW.bw && prevW && prevW.weight !== '' && prevW.weight !== 0 && (newW.weight === '' || newW.weight === 0)) {
            newW.weight = prevW.weight;
          }
          if (!newW.reps && prevW && prevW.reps !== '' && prevW.reps !== 0) {
            newW.reps = prevW.reps;
          }
          const newWarmups = [...warmups];
          newWarmups[emptyWarmupIdx] = newW;
          exercises[i] = { ...ex, warmupSets: newWarmups };
          toLog = {
            exercise: ex.name,
            exerciseIdx: i,
            setIdx: emptyWarmupIdx,
            isWarmup: true,
            setNumber: emptyWarmupIdx + 1,
            time: adjusted,
            weight: newW.weight,
            reps: newW.reps,
            bw: newW.bw || isBW,
            prevTime: prevW?.time,
            prevWeight: prevW?.weight,
          };
          return { ...s, exercises };
        }

        // Otherwise fill the next empty working set
        const emptyIdx = ex.sets.findIndex((st) => st.time === '' && st.reps === '' && !st.failure);
        if (emptyIdx === -1) continue;
        const prevSet = prev?.setData?.[emptyIdx];
        const newSet = { ...ex.sets[emptyIdx], time: adjusted };
        if (!isBW && !newSet.bw && prevSet && prevSet.weight !== '' && prevSet.weight !== 0 && (newSet.weight === '' || newSet.weight === 0)) {
          newSet.weight = prevSet.weight;
        }
        const newSets = [...ex.sets];
        newSets[emptyIdx] = newSet;
        exercises[i] = { ...ex, sets: newSets };
        toLog = {
          exercise: ex.name,
          exerciseIdx: i,
          setIdx: emptyIdx,
          isWarmup: false,
          setNumber: emptyIdx + 1,
          time: adjusted,
          weight: newSet.weight,
          reps: newSet.reps,
          bw: newSet.bw || isBW,
          prevTime: prevSet?.time,
          prevWeight: prevSet?.weight,
        };
        return { ...s, exercises };
      }
      return s;
    });
    // Defer the state update to avoid double-render warnings inside the setSession updater
    if (toLog) setTimeout(() => setLastLogged(toLog), 0);
  };

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Dumbbell className="w-10 h-10 text-orange-500 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      {showConfetti && <ConfettiOverlay />}
      {showSaveConfirm && (
        <ConfirmDialog
          title={editingExistingId ? 'Overwrite past session?' : 'Ready to save?'}
          message={editingExistingId
            ? 'You are about to permanently change a previously saved session.\n\nHold the red button to confirm. Release to cancel.'
            : 'This will file the current session and reset for the next workout.'}
          confirmLabel={editingExistingId ? 'HOLD TO OVERWRITE' : 'SAVE'}
          cancelLabel={editingExistingId ? 'BACK' : 'KEEP GOING'}
          danger={!!editingExistingId}
          onConfirm={saveCurrentSession}
          onCancel={() => setShowSaveConfirm(false)}
        />
      )}
      {summaryData && (
        <SessionSummary
          justSaved={summaryData.justSaved}
          previousSameProgramme={summaryData.previousSameProgramme}
          allSessions={summaryData.allSessions}
          onContinue={() => setSummaryData(null)}
        />
      )}
      {view === 'stats' ? (
        <StatsView sessions={sessions} onBack={() => setView('log')} />
      ) : view === 'history' ? (
        <HistoryView
          sessions={sessions}
          onBack={() => setView('log')}
          onDelete={deleteHistorySession}
          onOpen={openHistorySession}
          onReload={async () => {
            const all = await storage.listSessions();
            setSessions(all);
          }}
        />
      ) : (
        <div className="min-h-screen bg-black pb-40 overflow-x-hidden" style={{ fontFamily: 'var(--font-body)' }}>
          {/* Header */}
          <div className="bg-black border-b-4 border-white px-3 py-3 flex items-center justify-between sticky top-0 z-10 gap-2">
            <div className="flex items-center gap-2 min-w-0 shrink">
              <div className="w-8 h-8 bg-orange-500 flex items-center justify-center rounded shrink-0">
                <Dumbbell className="w-5 h-5 text-black" />
              </div>
              <h1 className="text-base text-white tracking-widest leading-none truncate" style={{ fontFamily: 'var(--font-display)' }}>
                FUCK OFF<br/><span className="text-orange-500 text-[10px] tracking-[0.3em]">GAINS TRACKER</span>
              </h1>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => setShowSaveConfirm(true)}
                className={`h-10 px-3 rounded flex items-center justify-center gap-1.5 active:opacity-80 transition-colors ${
                  savedFlash ? 'bg-green-500 text-black' :
                  editingExistingId ? 'bg-amber-500 text-black' :
                  'bg-white text-black'
                }`}
                style={{ fontFamily: 'var(--font-display)' }}
                aria-label={editingExistingId ? 'Save changes' : 'Save session'}
              >
                {savedFlash ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span className="text-[10px] font-bold tracking-widest">SAVE</span>
                  </>
                )}
              </button>
              <button onClick={() => setView('stats')} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800" aria-label="Stats">
                <BarChart3 className="w-5 h-5 text-neutral-300" />
              </button>
              <button onClick={() => setView('history')} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
                <History className="w-5 h-5 text-neutral-300" />
              </button>
              <button onClick={resetSession} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
                <FileText className="w-5 h-5 text-neutral-300" />
              </button>
            </div>
          </div>

          {/* Edit mode banner - shown when editing a past session */}
          {editingExistingId && session && (
            <div className="bg-amber-600 text-black px-4 py-2.5 flex items-center justify-between sticky top-[68px] z-10">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Edit3 className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[9px] tracking-[0.25em] font-bold uppercase leading-none" style={{ fontFamily: 'var(--font-display)' }}>EDITING PAST SESSION</div>
                  <div className="text-xs font-mono mt-0.5 truncate">
                    {session.date ? new Date(session.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </div>
                </div>
              </div>
              <button
                onClick={cancelEdit}
                className="h-8 px-3 bg-black/20 hover:bg-black/30 active:bg-black/40 rounded text-[10px] font-bold tracking-widest flex items-center gap-1 shrink-0"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                <X className="w-3.5 h-3.5" /> CANCEL
              </button>
            </div>
          )}

          {/* Session Meta: Date, Muscle Group, Duration, WHOOP */}
          <div className="px-4 pt-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Date</label>
                <input
                  type="date"
                  value={session.date}
                  onChange={(e) => updateSession({ date: e.target.value })}
                  className="fogt-date-input w-full bg-neutral-900 border border-neutral-800 text-white px-2 h-11 rounded text-[13px] block"
                  style={{
                    minWidth: 0,
                    maxWidth: '100%',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    textAlign: 'left',
                    textAlignLast: 'left',
                    lineHeight: '44px',
                    fontVariantNumeric: 'tabular-nums',
                    direction: 'ltr',
                  }}
                />
                {/* iOS Safari overrides text-align inside the date input via pseudo-elements; pin them with scoped CSS. */}
                <style>{`
                  .fogt-date-input { text-align: left !important; text-align-last: left !important; }
                  .fogt-date-input::-webkit-date-and-time-value { text-align: left !important; padding-left: 0 !important; margin: 0 !important; min-height: 1em; }
                  .fogt-date-input::-webkit-datetime-edit { text-align: left !important; padding: 0 !important; }
                  .fogt-date-input::-webkit-datetime-edit-fields-wrapper { padding: 0 !important; }
                `}</style>
              </div>
              <div className="shrink-0" style={{ width: '90px' }}>
                <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Duration</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={session.durationMin}
                  onChange={(e) => updateSession({ durationMin: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 text-white px-2 h-11 rounded text-[13px] text-center"
                  style={{ minWidth: 0 }}
                  placeholder="60"
                />
              </div>
            </div>

            {/* WHOOP block */}
            <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase font-semibold" style={{ fontFamily: 'var(--font-display)' }}>WHOOP</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] tracking-widest text-neutral-500 uppercase block mb-1">Recovery %</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="100"
                    value={session.whoopRecovery}
                    onChange={(e) => updateSession({ whoopRecovery: e.target.value })}
                    className="w-full bg-black border border-neutral-800 text-white px-3 h-11 rounded text-lg text-center"
                    placeholder="85"
                  />
                </div>
                <div>
                  <label className="text-[10px] tracking-widest text-neutral-500 uppercase block mb-1">Relative Recovery</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={session.whoopRelRecovery}
                    onChange={(e) => updateSession({ whoopRelRecovery: e.target.value })}
                    className="w-full bg-black border border-neutral-800 text-white px-3 h-11 rounded text-lg text-center"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Programme Selector */}
          <div className="px-4 mt-4">
            <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-2" style={{ fontFamily: 'var(--font-display)' }}>Programme</label>
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-1 flex gap-1">
              {Object.entries(PROGRAMMES).map(([key, p]) => {
                const active = (session.programme || 'anterior') === key;
                return (
                  <button
                    key={key}
                    onClick={() => switchProgramme(key)}
                    className={`flex-1 h-11 rounded-md font-bold tracking-[0.15em] text-sm transition-colors ${
                      active
                        ? 'bg-orange-500 text-black'
                        : 'bg-transparent text-neutral-400 active:bg-neutral-800'
                    }`}
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {p.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Exercises */}
          <div className="mt-4">
            {/* Last session summary - shown only on fresh sessions when there's a prior same-programme record */}
            {!editingExistingId && (() => {
              const currentProgramme = session?.programme;
              if (!currentProgramme) return null;
              const sameProg = sessions
                .filter((s) => s.programme === currentProgramme)
                .sort((a, b) => {
                  const dA = String(a.date || '').slice(0, 10);
                  const dB = String(b.date || '').slice(0, 10);
                  if (dB !== dA) return dB > dA ? 1 : -1;
                  return (Number(b.id) || 0) - (Number(a.id) || 0);
                });
              const last = sameProg[0];
              if (!last) return null;
              const lastTUT = sessionTUT(last);
              const lastTonnage = sessionTonnage(last);
              const lastSets = sessionSetCount(last);
              // Count of included exercises that had at least one logged set
              const lastExerciseCount = (last.exercises || [])
                .filter((ex) => ex.included !== false)
                .filter((ex) => (ex.sets || []).some((s) => (Number(s.time) || 0) > 0 || (Number(s.reps) || 0) > 0 || (Number(s.weight) || 0) > 0))
                .length;
              const lastDate = new Date(last.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
              const programmeLabel = (PROGRAMMES[currentProgramme]?.label || currentProgramme).toUpperCase();
              return (
                <div className="mb-3 mx-4 bg-neutral-950 border border-neutral-800 rounded-xl p-3">
                  <div className="text-[9px] tracking-[0.3em] text-neutral-500 font-mono mb-2">
                    LAST {programmeLabel} · {lastDate}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <div className="text-[8px] tracking-widest text-neutral-600 font-mono">EXERCISES</div>
                      <div className="text-base font-bold font-mono text-white leading-none mt-0.5">{lastExerciseCount}</div>
                    </div>
                    <div>
                      <div className="text-[8px] tracking-widest text-neutral-600 font-mono">SETS</div>
                      <div className="text-base font-bold font-mono text-white leading-none mt-0.5">{lastSets}</div>
                    </div>
                    <div>
                      <div className="text-[8px] tracking-widest text-neutral-600 font-mono">TUT</div>
                      <div className="text-base font-bold font-mono text-sky-300 leading-none mt-0.5">{Math.floor(lastTUT/60)}:{String(lastTUT%60).padStart(2,'0')}</div>
                    </div>
                    <div>
                      <div className="text-[8px] tracking-widest text-neutral-600 font-mono" title="Weight × time across all working sets - heavier or longer both push it up">TONNAGE</div>
                      <div className="text-base font-bold font-mono text-amber-300 leading-none mt-0.5">{Math.round(lastTonnage)}<span className="text-[9px] text-neutral-500 ml-0.5">kg·s</span></div>
                    </div>
                  </div>
                  {last.whoopRecovery && (
                    <div className="mt-2 pt-2 border-t border-neutral-900 text-[10px] text-neutral-500 font-mono flex items-center gap-3">
                      <span>WHOOP {last.whoopRecovery}%</span>
                      {last.rating && <span>· Rated {last.rating}/10</span>}
                    </div>
                  )}
                  <div className="mt-2 text-[9px] text-neutral-600 leading-relaxed">
                    Tonnage = total weight × time across all working sets. The single best progressive-overload number for time-based training: heavier load or longer hold both increase it.
                  </div>
                </div>
              );
            })()}
            <div className="bg-white px-4 py-2 flex items-center justify-between">
              <h2 className="text-black tracking-[0.25em] text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                EXERCISES
              </h2>
              <span className="text-black text-xs font-mono">
                {editingExistingId
                  ? session.exercises.filter((ex) => ex.included !== false).length
                  : session.exercises.length}
              </span>
            </div>
            <div>
              {session.exercises.map((ex, i) => {
                // When viewing/editing a past session from History, hide exercises that were toggled off.
                // For fresh sessions still in progress, show everything so the user can toggle them on/off.
                if (editingExistingId && ex.included === false) return null;
                return (
                  <ExerciseRow
                    key={i}
                    exercise={ex}
                    index={i}
                    prev={previousByExercise[ex.name]}
                    onChange={(newEx) => updateExercise(i, newEx)}
                    onEditSet={(setIdx) => setEditingSet({ exerciseIdx: i, setIdx, warmup: false })}
                    onEditWarmup={(setIdx) => setEditingSet({ exerciseIdx: i, setIdx, warmup: true })}
                    onDelete={() => deleteExercise(i)}
                    onRename={(name) => updateExercise(i, { ...ex, name })}
                    onAddSet={() => updateExercise(i, { ...ex, sets: [...ex.sets, { reps: '', weight: '', time: '', failure: false, bw: false }] })}
                    onRemoveSet={() => updateExercise(i, { ...ex, sets: ex.sets.slice(0, -1) })}
                    onAddWarmup={() => addWarmup(i)}
                    onRemoveWarmup={() => removeWarmup(i)}
                    onToggleIncluded={() => toggleIncluded(i)}
                  />
                );
              })}
            </div>
            <button
              onClick={addExercise}
              className="w-full py-4 border-b border-dashed border-neutral-800 text-neutral-400 text-sm flex items-center justify-center gap-2 active:bg-neutral-950"
            >
              <Plus className="w-4 h-4" /> Add exercise
            </button>
          </div>

          {/* Notes & Rating */}
          <div className="mt-6 px-4 space-y-3">
            <div className="bg-white px-2 py-2 -mx-4 mb-3">
              <h2 className="text-black tracking-[0.25em] text-lg font-bold px-2" style={{ fontFamily: 'var(--font-display)' }}>NOTES</h2>
            </div>
            <textarea
              value={session.notes}
              onChange={(e) => updateSession({ notes: e.target.value })}
              className="w-full bg-neutral-900 border border-neutral-800 text-white px-3 py-2 rounded text-sm min-h-[80px] resize-none"
              placeholder="Form notes, how it felt, equipment used..."
            />
            <div>
              <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-2" style={{ fontFamily: 'var(--font-display)' }}>Workout Rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => updateSession({ rating: session.rating === n ? '' : n })}
                    className={`flex-1 h-10 rounded text-sm font-mono ${session.rating === n ? 'bg-orange-500 text-black font-bold' : 'bg-neutral-900 border border-neutral-800 text-neutral-400'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sticky bottom bar: Timer + Save */}
          <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t-2 border-neutral-900 z-20">
            <div className="p-3 space-y-2">
              <TimerWidget
                key={session?.id || 'no-session'}
                compact
                onStop={handleTimerStop}
                lastLogged={lastLogged}
                onClearLastLogged={() => setLastLogged(null)}
                onEditLastLogged={() => {
                  if (!lastLogged) return;
                  setEditingSet({
                    exerciseIdx: lastLogged.exerciseIdx,
                    setIdx: lastLogged.setIdx,
                    warmup: !!lastLogged.isWarmup,
                  });
                }}
              />
            </div>
          </div>

          {/* Set editor bottom sheet */}
          {editingSet && (() => {
            const ex = session.exercises[editingSet.exerciseIdx];
            const prev = previousByExercise[ex.name];
            // Pull suggestions from the matching slot of the prior session.
            // Working sets read prev.setData; warmups read prev.warmupSetData.
            let suggested = null;
            if (editingSet.warmup) {
              const ws = prev?.warmupSetData?.[editingSet.setIdx];
              if (ws && (ws.weight !== '' || ws.reps !== '' || ws.bw)) {
                suggested = { weight: ws.weight, reps: ws.reps };
              }
            } else {
              const ps = prev?.setData?.[editingSet.setIdx];
              if (ps) {
                suggested = { weight: ps.weight, reps: ps.reps };
              }
            }
            const handleDeleteSet = () => {
              const updated = { ...ex };
              if (editingSet.warmup) {
                updated.warmupSets = (ex.warmupSets || []).filter((_, i) => i !== editingSet.setIdx);
              } else {
                updated.sets = (ex.sets || []).filter((_, i) => i !== editingSet.setIdx);
              }
              updateExercise(editingSet.exerciseIdx, updated);
              setEditingSet(null);
            };
            return (
              <SetEditor
                exercise={ex}
                setIndex={editingSet.setIdx}
                isWarmup={editingSet.warmup}
                suggested={suggested}
                onChange={(newEx) => {
                  updateExercise(editingSet.exerciseIdx, newEx);
                  // If we're editing the same cell that's currently shown in the lastLogged chip,
                  // refresh the chip so it shows the new values.
                  if (
                    lastLogged &&
                    lastLogged.exerciseIdx === editingSet.exerciseIdx &&
                    lastLogged.setIdx === editingSet.setIdx &&
                    !!lastLogged.isWarmup === !!editingSet.warmup
                  ) {
                    const updatedSet = editingSet.warmup
                      ? (newEx.warmupSets || [])[editingSet.setIdx]
                      : (newEx.sets || [])[editingSet.setIdx];
                    if (updatedSet) {
                      setLastLogged({
                        ...lastLogged,
                        time: updatedSet.time,
                        weight: updatedSet.weight,
                        reps: updatedSet.reps,
                        bw: updatedSet.bw || (newEx.unit === 'bw'),
                      });
                    }
                  }
                }}
                onClose={() => setEditingSet(null)}
                onDeleteSet={handleDeleteSet}
              />
            );
          })()}
        </div>
      )}
    </>
  );
}
