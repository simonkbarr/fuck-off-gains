import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Minus, Save, History, Trash2, X, Check, ChevronLeft, Edit3, FileText, Dumbbell, Zap, Timer, Play, Square, RotateCcw, Volume2, Download, Upload, AlertTriangle, Database, Mic, MicOff, Flame, Eye, EyeOff, Pause, Coffee } from 'lucide-react';

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
  whoopStrain: '',
  exercises: template.map((t) => ({
    name: t.name,
    unit: t.unit,
    superset: t.superset || false,
    // If we have a map of last-session included flags, use that. Default true.
    included: includedMap ? (includedMap[t.name] !== false) : true,
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
      return sessions.filter(Boolean).sort((a, b) => b.id - a.id);
    } catch { return []; }
  },
  async deleteSession(id) {
    try { await window.storage.delete(`session:${id}`); } catch (e) { console.error(e); }
  },
};

// ============================================================
// Bottom Sheet - Set Editor
// ============================================================
const SetEditor = ({ exercise, setIndex, onChange, onClose, isWarmup = false, suggested = null }) => {
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

        <button onClick={onClose} className="w-full h-14 bg-white text-black font-bold tracking-widest rounded-lg" style={{ fontFamily: 'var(--font-display)' }}>
          DONE
        </button>
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
    <div className={`border-b border-neutral-900 py-3 ${!included ? 'opacity-40' : ''}`}>
      {/* Header row */}
      <div className="flex items-start justify-between mb-1 px-1 gap-2">
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
        <div className="flex items-center gap-2 shrink-0">
          {/* Include toggle switch (iOS-style) */}
          <button
            onClick={onToggleIncluded}
            role="switch"
            aria-checked={included}
            aria-label="Include in workout"
            className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
              included ? 'bg-green-500' : 'bg-neutral-800'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
                included ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
          <button onClick={onDelete} className="text-neutral-600 p-1">
            <Trash2 className="w-4 h-4" />
          </button>
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
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
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
      )}

      {/* Warmup row (if any warmup sets exist, or add button) */}
      {(warmupSets.length > 0 || included) && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 px-1 mb-1">
            <Flame className="w-3 h-3 text-amber-500" />
            <span className="text-[9px] tracking-widest text-amber-500 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>WARM-UP</span>
            <span className="text-[9px] text-neutral-600 font-mono">(not counted in averages)</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
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
      )}

      {/* Working sets row */}
      <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
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
      const header = ['date','muscle_group','duration_min','whoop_recovery','whoop_strain','rating','exercise','superset','set_num','reps','weight_kg','bodyweight','time_sec','to_failure','notes'];
      const rows = [header];
      sessions.forEach((s) => {
        s.exercises.forEach((ex) => {
          ex.sets.forEach((set, i) => {
            const isBW = set.bw || ex.unit === 'bw';
            rows.push([
              s.date || '',
              s.muscleGroup || '',
              s.durationMin || '',
              s.whoopRecovery || '',
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
          {sessions.map((s) => {
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
                  {s.whoopStrain && <span className="text-orange-400">Strain {s.whoopStrain}</span>}
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
// Main App
// ============================================================
export default function App() {
  const [view, setView] = useState('log'); // 'log' | 'history'
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [editingSet, setEditingSet] = useState(null); // {exerciseIdx, setIdx, warmup?}
  const [loading, setLoading] = useState(true);
  const [savedFlash, setSavedFlash] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

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

  // Auto-save draft
  useEffect(() => {
    if (session && !loading) {
      const t = setTimeout(() => storage.setDraft(session), 400);
      return () => clearTimeout(t);
    }
  }, [session, loading]);

  // Build a map of exercise name -> most recent previous session stats for that exercise
  // Only considers "included" exercises, ignores warmup data in averages.
  const previousByExercise = useMemo(() => {
    const map = {};
    const pool = sessions.filter((s) => s.id !== session?.id);
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
  }, [sessions, session?.id]);

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
    await storage.saveSession(session);
    await storage.clearDraft();
    const all = await storage.listSessions();
    setSessions(all);
    // Save template from current exercise list, per-programme
    const template = session.exercises.map((e) => ({
      name: e.name, unit: e.unit, sets: e.sets.length, superset: e.superset,
    }));
    const programme = session.programme || 'anterior';
    await storage.setTemplate(template, programme);
    // Next session defaults to same programme but user can switch
    const next = await buildSessionForProgramme(programme, all);
    setSession(next);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
    // Bicep confetti celebration
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 4500);
  };

  const openHistorySession = (s) => {
    setSession(s);
    setView('log');
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
    if (newProgramme === session?.programme) return;
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
          title="Ready to save?"
          message="This will file the current session and reset for the next workout."
          confirmLabel="SAVE"
          cancelLabel="KEEP GOING"
          onConfirm={saveCurrentSession}
          onCancel={() => setShowSaveConfirm(false)}
        />
      )}
      {view === 'history' ? (
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
        <div className="min-h-screen bg-black pb-52" style={{ fontFamily: 'var(--font-body)' }}>
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
              <button onClick={() => setView('history')} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
                <History className="w-5 h-5 text-neutral-300" />
              </button>
              <button onClick={resetSession} className="w-10 h-10 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-center active:bg-neutral-800">
                <FileText className="w-5 h-5 text-neutral-300" />
              </button>
            </div>
          </div>

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
                  <label className="text-[10px] tracking-widest text-neutral-500 uppercase block mb-1">Day Strain</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    max="21"
                    value={session.whoopStrain}
                    onChange={(e) => updateSession({ whoopStrain: e.target.value })}
                    className="w-full bg-black border border-neutral-800 text-white px-3 h-11 rounded text-lg text-center"
                    placeholder="8.5"
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
                className={`w-full h-12 rounded-lg font-bold tracking-[0.2em] flex items-center justify-center gap-2 transition-colors ${savedFlash ? 'bg-green-500 text-black' : 'bg-white text-black active:bg-neutral-200'}`}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {savedFlash ? (
                  <>
                    <Check className="w-5 h-5" /> SAVED
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
            return (
              <SetEditor
                exercise={ex}
                setIndex={editingSet.setIdx}
                isWarmup={editingSet.warmup}
                suggested={suggested}
                onChange={(newEx) => updateExercise(editingSet.exerciseIdx, newEx)}
                onClose={() => setEditingSet(null)}
              />
            );
          })()}
        </div>
      )}
    </>
  );
}
