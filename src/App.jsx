import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Minus, Save, History, Trash2, X, Check, ChevronLeft, Edit3, FileText, Dumbbell, Zap, Timer, Play, Square, RotateCcw, Volume2, Download, Upload, AlertTriangle, Database, Mic, MicOff, Flame, Eye, EyeOff, Pause, Coffee, Trophy, TrendingUp, BarChart3, ArrowRight, Target } from 'lucide-react';

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

const emptyWarmup = () => ({ reps: '', weight: '', time: '', failure: false, bw: false, warmup: true });

const createEmptySession = (template, programme = 'anterior', includedMap = null) => ({
  id: Date.now(),
  date: new Date().toISOString().slice(0, 10),
  programme,
  muscleGroup: '',
  durationMin: '',
  whoopRecovery: '',
  whoopRelRecovery: '',
  exercises: template.map((t) => ({
    name: t.name,
    unit: t.unit,
    superset: t.superset || false,
    // Fresh sessions always start with every exercise included. User can toggle off during workout.
    included: true,
    warmupSets: [],
    sets: emptySets(t.sets),
  })),
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
  // PROGRAMMES defaults + fresh-toggle logic take effect cleanly. Bumped to 4.
  async runSwapMigration() {
    try {
      const r = await window.storage.get('schema-version');
      const version = r ? Number(r.value) : 0;
      if (version < 4) {
        await window.storage.delete('template:anterior');
        await window.storage.delete('template:posterior');
        await window.storage.delete('template'); // legacy pre-programme key
        await window.storage.delete('draft'); // clear stale draft with mismatched toggles
        await window.storage.set('schema-version', '4');
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

// Total volume = weight × reps across non-BW working sets
const sessionVolume = (session) => workingSets(session).reduce((sum, s) => {
  if (s.bw || s._unit === 'bw') return sum; // BW exercises excluded from volume
  const w = Number(s.weight) || 0;
  const r = Number(s.reps) || 0;
  return sum + w * r;
}, 0);

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

  // For warmup sets, reps is always the hero (no time tracking)
  const heroValue = isWarmup
    ? (hasReps ? set.reps : '-')
    : (hasTime ? set.time : (hasReps ? set.reps : '-'));
  const heroLabel = isWarmup ? 'REPS' : (hasTime ? 'SEC' : 'REPS');

  // Secondary line
  const bits = [];
  if (!isWarmup && hasTime && hasReps) bits.push(`${set.reps}r`);
  if (set.failure) bits.push('FAIL');
  else if (isBW) bits.push('BW');
  else if (set.weight !== '') bits.push(`${set.weight}kg`);

  // Delta vs previous session (only for working sets)
  let delta = null;
  if (!isWarmup && prevSet) {
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
      const hasTemplate = (all?.keys || []).includes('template');
      const hasDraft = (all?.keys || []).includes('draft');
      setDiagnostic({
        totalKeys: all?.keys?.length || 0,
        sessionKeys: sessionKeys.length,
        hasTemplate,
        hasDraft,
        allKeys: all?.keys || [],
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
            const totalSets = s.exercises.reduce((a, e) => a + e.sets.filter(x => x.reps).length, 0);
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
                    <div className="text-sm text-neutral-400">
                      {s.programme ? (PROGRAMMES[s.programme]?.label || s.programme).toUpperCase() : (s.muscleGroup || 'Session')}
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
// Supports compact mode (sticky floating bar) and optional voice control
// ============================================================
const TimerWidget = ({ compact = false, voiceEnabled = false, onVoiceToggle, onStop }) => {
  const [phase, setPhase] = useState('idle'); // idle | countdown | running
  const [countdown, setCountdown] = useState(5);
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('off'); // off | listening | error
  // Rest timer state
  const [restRunning, setRestRunning] = useState(false);
  const [restPaused, setRestPaused] = useState(false);
  const [restElapsed, setRestElapsed] = useState(0);
  const audioCtxRef = useRef(null);
  const wakeLockRef = useRef(null);
  const recognitionRef = useRef(null);
  const phaseRef = useRef(phase);
  const restStartMsRef = useRef(null);
  const restPausedAtRef = useRef(null);
  const restBeepedRef = useRef(new Set());

  // Keep phaseRef in sync so voice callbacks see current phase
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
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      const dur = durationMs / 1000;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.start(now);
      osc.stop(now + dur);
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
        const remaining = Math.max(0, 5 - Math.floor(totalMs / 1000));
        setCountdown(remaining);

        const tickKey = `cd-${remaining}`;
        if (remaining >= 1 && remaining <= 3 && !beeped.has(tickKey)) {
          beeped.add(tickKey);
          beep(600, 80, 0.45);
        }

        if (totalMs >= 5000 && !beeped.has('go')) {
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
      stopVoice();
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
    setCountdown(5);
    setElapsed(0);
    setPhase('countdown');
    // Starting a new set means rest is over
    stopRest();
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
    setCountdown(5);
    setElapsed(0);
  };

  // --- Voice control ---
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceStatus('error');
      return false;
    }
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-GB';
      rec.onresult = (event) => {
        const last = event.results[event.results.length - 1];
        const text = last[0].transcript.toLowerCase().trim();
        // Match against common phrasings
        if (/\b(start|go|begin)\b/.test(text) && phaseRef.current === 'idle') {
          start();
        } else if (/\b(stop|end|done|finish)\b/.test(text) && phaseRef.current !== 'idle') {
          stop();
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        setVoiceStatus('error');
      };
      rec.onend = () => {
        // Auto-restart if still enabled (recognition stops after a while)
        if (recognitionRef.current === rec && voiceEnabled) {
          try { rec.start(); } catch (e) { /* already started */ }
        }
      };
      recognitionRef.current = rec;
      rec.start();
      setVoiceStatus('listening');
      return true;
    } catch (e) {
      setVoiceStatus('error');
      return false;
    }
  };

  const stopVoice = () => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try { rec.stop(); } catch (e) {}
    }
    setVoiceStatus('off');
  };

  // Respond to parent voiceEnabled toggle
  useEffect(() => {
    if (voiceEnabled && voiceStatus === 'off') {
      startVoice();
    } else if (!voiceEnabled && voiceStatus !== 'off') {
      stopVoice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceEnabled]);

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
    const restMin = Math.floor(restElapsed / 60);
    const restSec = restElapsed % 60;
    const restDisplay = `${restMin}:${String(restSec).padStart(2, '0')}`;
    // Rest zone colouring matches the beep markers
    const restZone =
      restElapsed >= 120 ? 'late' :   // >= 2 min (triple beep fired)
      restElapsed >= 90 ? 'ready' :   // 90-120s (sweet spot)
      restElapsed >= 60 ? 'warming' : // 60-90s (can go)
      'resting';                       // <60s
    const restBgClass =
      restZone === 'late' ? 'bg-orange-950/90 border-orange-600' :
      restZone === 'ready' ? 'bg-green-950/90 border-green-600' :
      restZone === 'warming' ? 'bg-amber-950/90 border-amber-600' :
      'bg-sky-950/90 border-sky-800';
    const restNumColor =
      restZone === 'late' ? 'text-orange-300' :
      restZone === 'ready' ? 'text-green-300' :
      restZone === 'warming' ? 'text-amber-300' :
      'text-sky-200';

    return (
      <div className="space-y-2">
        {/* Rest timer strip - only shown while rest is active */}
        {restRunning && (
          <div className={`border-2 rounded-xl backdrop-blur-sm transition-colors duration-200 shadow-lg ${restBgClass}`}>
            {/* Top row: label + time + controls */}
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
              <Coffee className="w-4 h-4 text-neutral-300 shrink-0" />
              <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-neutral-300" style={{ fontFamily: 'var(--font-display)' }}>
                {restPaused ? 'Rest (Paused)' : 'Rest'}
              </span>
              <div className="flex-1 flex items-baseline justify-center gap-2">
                <div className={`font-mono text-2xl font-bold leading-none ${restNumColor}`}>{restDisplay}</div>
                <div className={`font-mono text-xs leading-none ${restNumColor} opacity-70`}>{restElapsed}s</div>
              </div>
              <button
                onClick={restPaused ? resumeRest : pauseRest}
                className="h-9 w-9 bg-neutral-900/80 border border-neutral-700 rounded-lg active:bg-neutral-800 flex items-center justify-center"
                aria-label={restPaused ? 'Resume rest timer' : 'Pause rest timer'}
              >
                {restPaused ? <Play className="w-4 h-4 fill-current text-neutral-200" /> : <Pause className="w-4 h-4 fill-current text-neutral-200" />}
              </button>
              <button
                onClick={stopRest}
                className="h-9 w-9 bg-neutral-900/80 border border-neutral-700 rounded-lg active:bg-neutral-800 flex items-center justify-center"
                aria-label="Stop rest timer"
              >
                <X className="w-4 h-4 text-neutral-300" />
              </button>
            </div>
            {/* Timeline with labelled markers at 1m, 90s, 2m */}
            <div className="px-3 pb-2.5">
              <div className="relative">
                {/* Track */}
                <div className="h-2 bg-neutral-900 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-200"
                    style={{
                      width: `${Math.min(100, (restElapsed / 120) * 100)}%`,
                      backgroundColor:
                        restElapsed >= 120 ? '#f97316' :
                        restElapsed >= 90 ? '#22c55e' :
                        restElapsed >= 60 ? '#f59e0b' :
                        '#38bdf8',
                    }}
                  />
                </div>
                {/* Marker ticks (positions: 1m=50%, 90s=75%, 2m=100%) */}
                <div className="absolute top-0 h-2 w-0.5 bg-amber-400" style={{ left: '50%' }} />
                <div className="absolute top-0 h-2 w-0.5 bg-green-400" style={{ left: '75%' }} />
                <div className="absolute top-0 h-2 w-0.5 bg-orange-400" style={{ left: 'calc(100% - 2px)' }} />
              </div>
              {/* Timeline labels */}
              <div className="relative mt-1 h-3">
                <span className="absolute left-0 text-[9px] font-mono text-neutral-500">0s</span>
                <span className={`absolute text-[9px] font-mono -translate-x-1/2 ${restElapsed >= 60 ? 'text-amber-400 font-bold' : 'text-neutral-500'}`} style={{ left: '50%' }}>1m</span>
                <span className={`absolute text-[9px] font-mono -translate-x-1/2 ${restElapsed >= 90 ? 'text-green-400 font-bold' : 'text-neutral-500'}`} style={{ left: '75%' }}>90s</span>
                <span className={`absolute right-0 text-[9px] font-mono ${restElapsed >= 120 ? 'text-orange-400 font-bold' : 'text-neutral-500'}`}>2m</span>
              </div>
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
              {voiceEnabled && (
                <span className={`text-[9px] tracking-wider font-mono ${voiceStatus === 'listening' ? 'text-red-400 animate-pulse' : 'text-neutral-600'}`}>
                  {voiceStatus === 'listening' ? '● MIC' : voiceStatus === 'error' ? 'MIC ERR' : 'MIC'}
                </span>
              )}
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
          {/* Voice toggle */}
          {onVoiceToggle && (
            <button
              onClick={onVoiceToggle}
              className={`h-14 w-10 rounded-lg flex items-center justify-center shrink-0 border ${
                voiceEnabled ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-neutral-900 border-neutral-800 text-neutral-500'
              }`}
              aria-label="Toggle voice control"
            >
              {voiceEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
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
const ConfirmDialog = ({ title, message, confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL', onConfirm, onCancel }) => {
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
        className="border-2 border-orange-500 rounded-2xl p-5 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#000000' }}
      >
        <div className="text-xl font-bold text-white mb-2 tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>
          {title}
        </div>
        {message && <div className="text-sm text-neutral-400 mb-5">{message}</div>}
        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 h-12 bg-neutral-900 border border-neutral-800 text-neutral-200 rounded-lg font-bold tracking-[0.15em] active:bg-neutral-800"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 h-12 bg-orange-500 text-black rounded-lg font-bold tracking-[0.15em] active:bg-orange-600"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {confirmLabel}
          </button>
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
  const vol = sessionVolume(justSaved);
  const prevVol = previousSameProgramme ? sessionVolume(previousSameProgramme) : null;
  const sets = sessionSetCount(justSaved);
  const prevSets = previousSameProgramme ? sessionSetCount(previousSameProgramme) : null;
  const avgTime = sessionAvgSetTime(justSaved);
  const prevAvg = previousSameProgramme ? sessionAvgSetTime(previousSameProgramme) : null;
  const reps = sessionTotalReps(justSaved);
  const prevReps = previousSameProgramme ? sessionTotalReps(previousSameProgramme) : null;

  const prs = detectPRs(justSaved, allSessions);
  const highlights = generateHighlights(justSaved, previousSameProgramme);
  const programmeName = (PROGRAMMES[justSaved.programme]?.label || justSaved.programme || 'Session').toUpperCase();

  return (
    <div className="fixed inset-0 z-[9998] overflow-y-auto" style={{ backgroundColor: '#000000' }}>
      <div className="min-h-screen p-5 pb-8 flex flex-col max-w-md mx-auto">
        {/* Header */}
        <div className="pt-6 pb-5 text-center">
          <div className="text-[10px] tracking-[0.35em] text-orange-500 font-semibold uppercase mb-2" style={{ fontFamily: 'var(--font-display)' }}>{programmeName} COMPLETE</div>
          <div className="text-3xl font-bold text-white tracking-widest leading-none" style={{ fontFamily: 'var(--font-display)' }}>SESSION BANKED</div>
          {justSaved.durationMin && <div className="text-xs text-neutral-500 mt-3 font-mono">{justSaved.durationMin} min{justSaved.rating ? ` · rated ${justSaved.rating}/10` : ''}</div>}
        </div>

        {/* Metric grid */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <MetricCard label="Time Under Tension" value={tut} subunit="s" prev={prevTUT} current={tut} unit="s" />
          <MetricCard label="Total Volume" value={Math.round(vol)} subunit="kg·r" prev={prevVol} current={vol} unit="" />
          <MetricCard label="Avg Set Time" value={avgTime.toFixed(1)} subunit="s" prev={prevAvg} current={avgTime} unit="s" />
          <MetricCard label="Sets Completed" value={sets} prev={prevSets} current={sets} unit="" />
          <MetricCard label="Total Reps" value={reps} prev={prevReps} current={reps} unit="" />
          {justSaved.whoopRecovery && <MetricCard label="WHOOP Recovery" value={justSaved.whoopRecovery} subunit="%" prev={previousSameProgramme?.whoopRecovery ? Number(previousSameProgramme.whoopRecovery) : null} current={Number(justSaved.whoopRecovery)} unit="%" />}
        </div>

        {/* PRs */}
        {prs.length > 0 && (
          <div className="mb-4 bg-amber-950/40 border-2 border-amber-600 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span className="text-xs tracking-[0.3em] text-amber-400 font-bold uppercase" style={{ fontFamily: 'var(--font-display)' }}>Personal Bests</span>
            </div>
            <div className="space-y-1.5">
              {prs.map((pr, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-white truncate pr-2">{pr.exercise}</span>
                  <span className="text-amber-300 font-mono text-xs shrink-0">{pr.prev}{pr.unit} → <span className="text-amber-200 font-bold">{pr.current}{pr.unit}</span></span>
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
  // Overview totals
  const totals = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    let totalTUT = 0, totalVol = 0, totalReps = 0, totalSets = 0, totalMin = 0;
    sorted.forEach((s) => {
      totalTUT += sessionTUT(s);
      totalVol += sessionVolume(s);
      totalReps += sessionTotalReps(s);
      totalSets += sessionSetCount(s);
      totalMin += Number(s.durationMin) || 0;
    });
    // Streak: count consecutive weeks with at least one session
    const weeks = new Set(sorted.map((s) => weekKey(s.date)).filter(Boolean));
    return { sessions: sorted.length, totalTUT, totalVol, totalReps, totalSets, totalMin, weeksTrained: weeks.size };
  }, [sessions]);

  // Programme split
  const programmeSplit = useMemo(() => {
    const counts = { anterior: 0, posterior: 0, other: 0 };
    sessions.forEach((s) => {
      const p = s.programme || 'other';
      if (counts[p] !== undefined) counts[p]++;
      else counts.other++;
    });
    return counts;
  }, [sessions]);

  // Weekly frequency (last 8 weeks)
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

  // Per-exercise progression: group all sessions by exercise name, show TUT per session
  const exerciseProgression = useMemo(() => {
    const map = new Map();
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((s) => {
      (s.exercises || []).filter((ex) => ex.included !== false).forEach((ex) => {
        if (!map.has(ex.name)) map.set(ex.name, []);
        const tut = (ex.sets || []).reduce((sum, set) => sum + (Number(set.time) || 0), 0);
        const vol = (ex.sets || []).reduce((sum, set) => sum + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0);
        const maxWeight = Math.max(0, ...(ex.sets || []).map((s) => Number(s.weight) || 0));
        map.get(ex.name).push({
          label: new Date(s.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          tut,
          vol,
          maxWeight,
          date: s.date,
        });
      });
    });
    return Array.from(map.entries())
      .filter(([, arr]) => arr.length >= 1)
      .sort((a, b) => b[1].length - a[1].length);
  }, [sessions]);

  // Personal bests across all exercises
  const personalBests = useMemo(() => {
    const bests = new Map();
    sessions.forEach((s) => {
      (s.exercises || []).filter((ex) => ex.included !== false).forEach((ex) => {
        if (!bests.has(ex.name)) bests.set(ex.name, { weight: { val: 0, date: null }, time: { val: 0, date: null }, reps: { val: 0, date: null }, unit: ex.unit });
        const best = bests.get(ex.name);
        (ex.sets || []).forEach((set) => {
          const w = Number(set.weight) || 0;
          const t = Number(set.time) || 0;
          const r = Number(set.reps) || 0;
          if (w > best.weight.val) best.weight = { val: w, date: s.date };
          if (t > best.time.val) best.time = { val: t, date: s.date };
          if (r > best.reps.val) best.reps = { val: r, date: s.date };
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

  // Rating distribution
  const ratingDist = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: 0 }));
    sessions.forEach((s) => {
      const r = Number(s.rating);
      if (r >= 1 && r <= 10) buckets[r - 1].value++;
    });
    return buckets;
  }, [sessions]);

  const [expanded, setExpanded] = useState(new Set());
  const toggleExpanded = (name) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const [exMetric, setExMetric] = useState('tut'); // 'tut' | 'vol' | 'weight'

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
          <div className="text-[9px] tracking-widest text-neutral-500 mt-0.5">{totals.sessions} sessions · {totals.weeksTrained} weeks trained</div>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-md mx-auto">
        {/* Overview banner */}
        <section>
          <SectionTitle icon={<Target className="w-3.5 h-3.5" />}>ALL TIME</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard label="Sessions" value={totals.sessions} />
            <MetricCard label="Hours in Gym" value={(totals.totalMin / 60).toFixed(1)} />
            <MetricCard label="Total TUT" value={`${Math.round(totals.totalTUT / 60)}`} subunit="min" />
            <MetricCard label="Total Volume" value={`${Math.round(totals.totalVol).toLocaleString()}`} subunit="kg·r" />
            <MetricCard label="Total Sets" value={totals.totalSets} />
            <MetricCard label="Total Reps" value={totals.totalReps} />
          </div>
        </section>

        {/* Programme split */}
        <section>
          <SectionTitle icon={<Dumbbell className="w-3.5 h-3.5" />}>PROGRAMME SPLIT</SectionTitle>
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4">
            {(() => {
              const total = programmeSplit.anterior + programmeSplit.posterior + programmeSplit.other;
              if (total === 0) return <div className="text-xs text-neutral-600 text-center py-2">No programme data</div>;
              const antPct = (programmeSplit.anterior / total) * 100;
              const postPct = (programmeSplit.posterior / total) * 100;
              const otherPct = (programmeSplit.other / total) * 100;
              return (
                <>
                  <div className="flex h-8 rounded overflow-hidden mb-3">
                    {antPct > 0 && <div style={{ width: `${antPct}%` }} className="bg-orange-500 flex items-center justify-center text-[10px] text-black font-bold">{programmeSplit.anterior}</div>}
                    {postPct > 0 && <div style={{ width: `${postPct}%` }} className="bg-green-500 flex items-center justify-center text-[10px] text-black font-bold">{programmeSplit.posterior}</div>}
                    {otherPct > 0 && <div style={{ width: `${otherPct}%` }} className="bg-neutral-600 flex items-center justify-center text-[10px] text-black font-bold">{programmeSplit.other}</div>}
                  </div>
                  <div className="flex items-center justify-between text-[10px] tracking-widest font-mono">
                    <span className="text-orange-400">ANTERIOR {antPct.toFixed(0)}%</span>
                    <span className="text-green-400">POSTERIOR {postPct.toFixed(0)}%</span>
                    {programmeSplit.other > 0 && <span className="text-neutral-500">OTHER {otherPct.toFixed(0)}%</span>}
                  </div>
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

        {/* WHOOP Recovery vs TUT scatter */}
        {recoveryScatter.length >= 2 && (
          <section>
            <SectionTitle icon={<Zap className="w-3.5 h-3.5" />}>RECOVERY vs PERFORMANCE</SectionTitle>
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
              <ScatterPlot data={recoveryScatter} height={160} xLabel="Recovery %" yLabel="Session TUT" />
              <div className="text-[9px] text-neutral-500 mt-1 text-center tracking-widest font-mono">{recoveryScatter.length} data points</div>
            </div>
          </section>
        )}

        {/* Per-exercise progression */}
        {exerciseProgression.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle icon={<TrendingUp className="w-3.5 h-3.5" />} mb="mb-0">EXERCISE PROGRESSION</SectionTitle>
            </div>
            <div className="flex gap-1 mb-3 bg-neutral-900 p-1 rounded-lg">
              {['tut', 'vol', 'weight'].map((m) => (
                <button
                  key={m}
                  onClick={() => setExMetric(m)}
                  className={`flex-1 h-8 rounded-md text-[10px] tracking-widest font-bold ${exMetric === m ? 'bg-orange-500 text-black' : 'text-neutral-400'}`}
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {m === 'tut' ? 'TIME' : m === 'vol' ? 'VOLUME' : 'WEIGHT'}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {exerciseProgression.map(([name, arr]) => {
                const isOpen = expanded.has(name);
                const latest = arr[arr.length - 1];
                const first = arr[0];
                const metricKey = exMetric === 'tut' ? 'tut' : exMetric === 'vol' ? 'vol' : 'maxWeight';
                const unit = exMetric === 'tut' ? 's' : exMetric === 'vol' ? '' : 'kg';
                const chartData = arr.map((a) => ({ label: a.label, value: a[metricKey] }));
                const deltaVal = arr.length >= 2 ? latest[metricKey] - first[metricKey] : 0;
                return (
                  <div key={name} className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden">
                    <button onClick={() => toggleExpanded(name)} className="w-full p-3 flex items-center justify-between text-left active:bg-neutral-900">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="text-sm font-semibold text-white truncate">{name}</div>
                        <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{arr.length} session{arr.length === 1 ? '' : 's'} · latest {latest[metricKey]}{unit}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {arr.length >= 2 && (
                          <span className={`text-[11px] font-mono font-bold ${deltaVal > 0 ? 'text-green-400' : deltaVal < 0 ? 'text-orange-400' : 'text-neutral-500'}`}>
                            {deltaVal > 0 ? '↑' : deltaVal < 0 ? '↓' : '='}{Math.abs(Math.round(deltaVal))}{unit}
                          </span>
                        )}
                        <span className="text-neutral-600 text-xs">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-neutral-900 p-3">
                        <LineChart data={chartData} height={110} unit={unit} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Personal bests */}
        {personalBests.length > 0 && (
          <section>
            <SectionTitle icon={<Trophy className="w-3.5 h-3.5" />}>PERSONAL BESTS</SectionTitle>
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-900">
              {personalBests.map(([name, best]) => (
                <div key={name} className="p-3">
                  <div className="text-sm font-semibold text-white mb-1.5 truncate">{name}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
                    {best.weight.val > 0 && best.unit !== 'bw' && (
                      <span className="text-amber-400">MAX {best.weight.val}kg<span className="text-neutral-600"> · {new Date(best.weight.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></span>
                    )}
                    {best.time.val > 0 && (
                      <span className="text-sky-400">TUT {best.time.val}s<span className="text-neutral-600"> · {new Date(best.time.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></span>
                    )}
                    {best.reps.val > 0 && best.unit === 'bw' && (
                      <span className="text-green-400">REPS {best.reps.val}<span className="text-neutral-600"> · {new Date(best.reps.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></span>
                    )}
                  </div>
                </div>
              ))}
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
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
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

  // Helper: build a new session for a given programme, pulling in last-time's included flags
  // and any custom exercises that were part of that last session (so user's additions carry over)
  const buildSessionForProgramme = async (programme, sessionsList) => {
    const base = PROGRAMMES[programme]?.exercises || PROGRAMMES.anterior.exercises;
    const storedTemplate = await storage.getTemplate(programme);
    const template = storedTemplate || base;
    const includedMap = buildIncludedMap(sessionsList, programme);
    return createEmptySession(template, programme, includedMap);
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
    // Filter to same-programme sessions, exclude the currently-loaded one, sort newest first
    const pool = sessions
      .filter((s) => s.id !== session?.id)
      .filter((s) => !currentProgramme || s.programme === currentProgramme)
      .sort((a, b) => {
        const dA = new Date(a.date).getTime();
        const dB = new Date(b.date).getTime();
        if (dB !== dA) return dB - dA; // newer first
        return (b.id || 0) - (a.id || 0); // tie-break by id
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
        map[ex.name] = {
          date: s.date,
          avgTime: withTime.length > 0 ? withTime.reduce((a, st) => a + parseFloat(st.time), 0) / withTime.length : null,
          avgWeight: withWeight.length > 0 ? withWeight.reduce((a, st) => a + parseFloat(st.weight), 0) / withWeight.length : null,
          totalReps: withReps.length > 0 ? withReps.reduce((a, st) => a + parseInt(st.reps), 0) : null,
          sets: workingSets.length,
          setData: workingSets.map((st) => ({
            time: st.time,
            weight: st.weight,
            reps: st.reps,
            bw: st.bw,
            failure: st.failure,
          })),
        };
      }
    }
    return map;
  }, [sessions, session?.id, session?.programme]);

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
    if (!toSave.date) toSave.date = new Date().toISOString();
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
    // Tapping the same programme: offer a fresh reset in case state is stale
    if (newProgramme === session?.programme) {
      if (!confirm(`Reset ${PROGRAMMES[newProgramme].label} day to a fresh session? Current unsaved data will be lost.`)) return;
      await storage.clearDraft();
      const next = await buildSessionForProgramme(newProgramme, sessions);
      setSession(next);
      return;
    }
    // Check if current session has any logged data
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

  // --- Timer stop callback: auto-fill next empty working set in first included exercise ---
  // Subtracts 3 seconds to compensate for delay between set completion and tapping stop
  const handleTimerStop = (elapsedSeconds) => {
    const adjusted = Math.max(1, elapsedSeconds - 3);
    setSession((s) => {
      if (!s) return s;
      const exercises = [...s.exercises];
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        if (ex.included === false) continue;
        const emptyIdx = ex.sets.findIndex((st) => st.time === '' && st.reps === '' && !st.failure);
        if (emptyIdx === -1) continue;
        // Pull suggested weight from previous session's same-numbered set
        const prev = previousByExercise[ex.name];
        const prevSet = prev?.setData?.[emptyIdx];
        const isBW = ex.unit === 'bw';
        const newSet = {
          ...ex.sets[emptyIdx],
          time: adjusted,
        };
        // Auto-fill weight from previous session's same set if available and not bodyweight
        if (!isBW && !newSet.bw && prevSet && prevSet.weight !== '' && prevSet.weight !== 0 && (newSet.weight === '' || newSet.weight === 0)) {
          newSet.weight = prevSet.weight;
        }
        const newSets = [...ex.sets];
        newSets[emptyIdx] = newSet;
        exercises[i] = { ...ex, sets: newSets };
        break;
      }
      return { ...s, exercises };
    });
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
          title={editingExistingId ? 'Save changes?' : 'Ready to save?'}
          message={editingExistingId ? 'This will overwrite the original session record.' : 'This will file the current session and reset for the next workout.'}
          confirmLabel={editingExistingId ? 'SAVE' : 'SAVE'}
          cancelLabel={editingExistingId ? 'BACK' : 'KEEP GOING'}
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
        <div className="min-h-screen bg-black pb-52 overflow-x-hidden" style={{ fontFamily: 'var(--font-body)' }}>
          {/* Header */}
          <div className="bg-black border-b-4 border-white px-4 py-3 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-500 flex items-center justify-center rounded">
                <Dumbbell className="w-5 h-5 text-black" />
              </div>
              <h1 className="text-xl text-white tracking-widest leading-none" style={{ fontFamily: 'var(--font-display)' }}>
                FUCK OFF<br/><span className="text-orange-500 text-sm tracking-[0.3em]">GAINS TRACKER</span>
              </h1>
            </div>
            <div className="flex gap-2">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Date</label>
                <input
                  type="date"
                  value={session.date}
                  onChange={(e) => updateSession({ date: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 text-white px-3 h-11 rounded text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Duration (min)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={session.durationMin}
                  onChange={(e) => updateSession({ durationMin: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-800 text-white px-3 h-11 rounded text-sm"
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
            <div className="bg-white px-4 py-2 flex items-center justify-between">
              <h2 className="text-black tracking-[0.25em] text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                EXERCISES
              </h2>
              <span className="text-black text-xs font-mono">{session.exercises.length}</span>
            </div>
            <div>
              {session.exercises.map((ex, i) => (
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
              ))}
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
                compact
                voiceEnabled={voiceEnabled}
                onVoiceToggle={() => setVoiceEnabled((v) => !v)}
                onStop={handleTimerStop}
              />
              <button
                onClick={() => setShowSaveConfirm(true)}
                className={`w-full h-12 rounded-lg font-bold tracking-[0.2em] flex items-center justify-center gap-2 transition-colors ${
                  savedFlash ? 'bg-green-500 text-black' :
                  editingExistingId ? 'bg-amber-500 text-black active:bg-amber-600' :
                  'bg-white text-black active:bg-neutral-200'
                }`}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {savedFlash ? (
                  <>
                    <Check className="w-5 h-5" /> SAVED
                  </>
                ) : editingExistingId ? (
                  <>
                    <Save className="w-5 h-5" /> SAVE CHANGES
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" /> SAVE SESSION
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Set editor bottom sheet */}
          {editingSet && (() => {
            const ex = session.exercises[editingSet.exerciseIdx];
            const prev = previousByExercise[ex.name];
            // Only pass suggestions for working sets (not warmups) from the same set index
            const suggested = !editingSet.warmup && prev?.setData?.[editingSet.setIdx] ? {
              weight: prev.setData[editingSet.setIdx].weight,
              reps: prev.setData[editingSet.setIdx].reps,
            } : null;
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
                onChange={(newEx) => updateExercise(editingSet.exerciseIdx, newEx)}
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
