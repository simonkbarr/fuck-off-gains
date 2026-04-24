import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Minus, Save, History, Trash2, X, Check, ChevronLeft, Edit3, FileText, Dumbbell, Zap, Timer, Play, Square, RotateCcw, Volume2, Download, Upload, AlertTriangle, Database } from 'lucide-react';

const DEFAULT_TEMPLATE = [
  { name: 'Heel Raise Goblet Squat', unit: 'kg', sets: 5 },
  { name: 'Leg Extension', unit: 'kg', sets: 2 },
  { name: 'Incline DB Chest Press', unit: 'kg', sets: 4 },
  { name: 'Press Up', unit: 'bw', sets: 3 },
  { name: 'DB Lat Raise', unit: 'kg', sets: 3 },
  { name: 'Triceps Push Down (Rope)', unit: 'kg', sets: 3, superset: true },
  { name: 'Ab Crunch', unit: 'bw', sets: 3 },
];

const emptySets = (n) => Array.from({ length: n }, () => ({ reps: '', weight: '', time: '', failure: false, bw: false }));

const createEmptySession = (template) => ({
  id: Date.now(),
  date: new Date().toISOString().slice(0, 10),
  muscleGroup: '',
  durationMin: '',
  whoopRecovery: '',
  whoopStrain: '',
  exercises: template.map((t) => ({
    name: t.name,
    unit: t.unit,
    superset: t.superset || false,
    sets: emptySets(t.sets),
  })),
  notes: '',
  rating: '',
});

// Storage helpers
const storage = {
  async getTemplate() {
    try {
      const r = await window.storage.get('template');
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async setTemplate(t) {
    try { await window.storage.set('template', JSON.stringify(t)); } catch (e) { console.error(e); }
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
const SetEditor = ({ exercise, setIndex, onChange, onClose }) => {
  const set = exercise.sets[setIndex];
  const isBW = exercise.unit === 'bw';

  const updateSet = (patch) => {
    const newSets = exercise.sets.map((s, i) => i === setIndex ? { ...s, ...patch } : s);
    onChange({ ...exercise, sets: newSets });
  };

  const bumpReps = (n) => updateSet({ reps: Math.max(0, (parseInt(set.reps) || 0) + n) });
  const bumpWeight = (n) => {
    const current = parseFloat(set.weight) || 0;
    const next = Math.max(0, Math.round((current + n) * 4) / 4);
    updateSet({ weight: next });
  };
  const bumpTime = (n) => updateSet({ time: Math.max(0, (parseInt(set.time) || 0) + n) });

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-neutral-950 border-t-2 border-orange-500 rounded-t-2xl p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-neutral-500 tracking-widest uppercase" style={{ fontFamily: 'var(--font-display)' }}>
              Set {setIndex + 1}
            </div>
            <div className="text-lg font-semibold text-white leading-tight">{exercise.name}</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 p-1">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Reps */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs tracking-widest text-neutral-500 uppercase" style={{ fontFamily: 'var(--font-display)' }}>Reps</label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => bumpReps(-1)} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
              <Minus className="w-5 h-5 text-neutral-300" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={set.reps}
              onChange={(e) => updateSet({ reps: e.target.value })}
              className="flex-1 h-14 bg-neutral-900 border border-neutral-800 text-center text-3xl text-white rounded-lg font-mono"
              placeholder="0"
            />
            <button onClick={() => bumpReps(1)} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
              <Plus className="w-5 h-5 text-neutral-300" />
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            {[-5, +5, +10].map((n) => (
              <button key={n} onClick={() => bumpReps(n)} className="flex-1 h-10 bg-neutral-900 border border-neutral-800 text-neutral-300 text-sm rounded-md active:bg-neutral-800 font-mono">
                {n > 0 ? `+${n}` : n}
              </button>
            ))}
          </div>
        </div>

        {/* Weight */}
        {!isBW && !set.bw && (
          <div className="mb-5">
            <label className="text-xs tracking-widest text-neutral-500 uppercase mb-2 block" style={{ fontFamily: 'var(--font-display)' }}>
              Weight (kg)
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => bumpWeight(-2.5)} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
                <Minus className="w-5 h-5 text-neutral-300" />
              </button>
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                value={set.weight}
                onChange={(e) => updateSet({ weight: e.target.value })}
                className="flex-1 h-14 bg-neutral-900 border border-neutral-800 text-center text-3xl text-white rounded-lg font-mono"
                placeholder="0"
              />
              <button onClick={() => bumpWeight(2.5)} className="h-14 w-14 bg-neutral-900 border border-neutral-800 active:bg-neutral-800 flex items-center justify-center rounded-lg">
                <Plus className="w-5 h-5 text-neutral-300" />
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {[-5, -1, 1, 5].map((n) => (
                <button key={n} onClick={() => bumpWeight(n)} className="flex-1 h-10 bg-neutral-900 border border-neutral-800 text-neutral-300 text-sm rounded-md active:bg-neutral-800 font-mono">
                  {n > 0 ? `+${n}` : n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Time */}
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
const SetCell = ({ set, unit, onClick, index, prevSet }) => {
  const isEmpty = set.reps === '' && set.weight === '' && set.time === '' && !set.failure && !set.bw;
  const hasTime = set.time !== '' && parseFloat(set.time) > 0;
  const hasReps = set.reps !== '' && parseInt(set.reps) > 0;
  const isBW = set.bw || unit === 'bw';

  // Time is the hero when logged, reps falls back otherwise
  const heroValue = hasTime ? set.time : (hasReps ? set.reps : '-');
  const heroLabel = hasTime ? 'SEC' : 'REPS';

  // Secondary: whatever isn't the hero
  const bits = [];
  if (hasTime && hasReps) bits.push(`${set.reps}r`);
  if (set.failure) bits.push('FAIL');
  else if (isBW) bits.push('BW');
  else if (set.weight !== '') bits.push(`${set.weight}kg`);

  // Compute delta vs previous session's same-numbered set
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

  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-[88px] h-[100px] border-2 flex flex-col items-center justify-between py-2 transition-colors rounded-md px-1 ${
        isEmpty ? 'border-dashed border-neutral-800 bg-neutral-950' : 'border-neutral-700 bg-neutral-900 active:bg-neutral-800'
      }`}
    >
      <div className="flex items-center justify-between w-full px-0.5">
        <span className="text-[9px] tracking-widest text-neutral-600 font-semibold uppercase" style={{ fontFamily: 'var(--font-display)' }}>
          SET {index + 1}
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
        <Plus className="w-5 h-5 text-neutral-700" />
      ) : (
        <>
          <div className="flex flex-col items-center -my-1">
            <div className="font-mono text-[28px] text-white leading-none font-bold">{heroValue}</div>
            <div className="text-[8px] text-neutral-500 tracking-widest mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>{heroLabel}</div>
          </div>
          <div className="font-mono text-[10px] text-orange-400 whitespace-nowrap h-3">
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
const ExerciseRow = ({ exercise, index, onChange, onEditSet, onDelete, onRename, onAddSet, onRemoveSet, prev, dragHandle }) => {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(exercise.name);

  const saveName = () => {
    if (nameValue.trim()) onRename(nameValue.trim());
    setEditingName(false);
  };

  // Format previous session summary
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

  return (
    <div className="border-b border-neutral-900 py-3">
      <div className="flex items-start justify-between mb-1 px-1">
        <div className="flex-1 min-w-0 pr-2">
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
        <button onClick={onDelete} className="text-neutral-600 p-1 shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Previous session line */}
      {prevLine && (
        <div className="px-1 mb-2 flex items-center gap-1.5">
          <span className="text-[9px] tracking-widest text-neutral-500 font-semibold" style={{ fontFamily: 'var(--font-display)' }}>LAST</span>
          <span className="text-[10px] text-neutral-500 font-mono truncate">{prevLine}</span>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {exercise.sets.map((set, i) => (
          <SetCell
            key={i}
            set={set}
            index={i}
            unit={exercise.unit}
            onClick={() => onEditSet(i)}
            prevSet={prev?.setData?.[i]}
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
                    <div className="text-sm text-neutral-400">{s.muscleGroup || 'Session'}</div>
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
// Timer Widget - Set Timer with 10s countdown, beeps at 30s & 40s
// ============================================================
const TimerWidget = () => {
  const [phase, setPhase] = useState('idle'); // idle | countdown | running
  const [countdown, setCountdown] = useState(10);
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(null);
  const audioCtxRef = useRef(null);
  const wakeLockRef = useRef(null);

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
        const remaining = Math.max(0, 10 - Math.floor(totalMs / 1000));
        setCountdown(remaining);

        // Short tick beep at 3, 2, 1
        const tickKey = `cd-${remaining}`;
        if (remaining >= 1 && remaining <= 3 && !beeped.has(tickKey)) {
          beeped.add(tickKey);
          beep(600, 80, 0.45);
        }

        // Transition to running at 10s
        if (totalMs >= 10000 && !beeped.has('go')) {
          beeped.add('go');
          beep(1200, 400, 0.6); // GO
          setPhase('running');
        }
      } else if (phase === 'running') {
        const seconds = Math.floor(totalMs / 1000);
        setElapsed(seconds);

        // 30s hit - single confirmation (you've made minimum target)
        if (seconds === 30 && !beeped.has(30)) {
          beeped.add(30);
          beep(880, 250, 0.6);
          setTimeout(() => beep(880, 250, 0.6), 300);
        }
        // 40s hit - urgent triple (stop now!)
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
    return () => releaseWakeLock();
  }, []);

  const start = () => {
    getAudio(); // unlock audio on user gesture
    beep(800, 80, 0.35); // confirm tap
    requestWakeLock();
    setFinalTime(null);
    setCountdown(10);
    setElapsed(0);
    setPhase('countdown');
  };

  const stop = () => {
    if (phase === 'running') {
      setFinalTime(elapsed);
    }
    releaseWakeLock();
    setPhase('idle');
  };

  const clearResult = () => {
    setFinalTime(null);
    setCountdown(10);
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

  const displayValue = isCountdown
    ? countdown
    : isRunning
      ? elapsed
      : (finalTime ?? 0);

  const progressValue = isRunning ? elapsed : (finalTime ?? 0);
  const progressPct = Math.min(100, (progressValue / 40) * 100);

  return (
    <div className={`mx-4 mt-4 border-2 rounded-lg p-4 transition-colors duration-200 ${
      zone === 'over' ? 'bg-red-950/60 border-red-500 animate-pulse' :
      zone === 'zone' ? 'bg-green-950/60 border-green-500' :
      zone === 'prep' ? 'bg-orange-950/40 border-orange-500' :
      'bg-neutral-950 border-neutral-800'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Timer className={`w-4 h-4 ${
            zone === 'zone' ? 'text-green-400' :
            zone === 'over' ? 'text-red-400' :
            'text-orange-500'
          }`} />
          <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-neutral-300" style={{ fontFamily: 'var(--font-display)' }}>
            {isCountdown ? 'Get Ready' :
             isRunning && zone === 'zone' ? 'In Zone' :
             isRunning && zone === 'over' ? 'Stop Now' :
             isRunning ? 'Working' :
             finalTime !== null ? 'Last Set' :
             'Set Timer'}
          </span>
        </div>
        <span className="text-[9px] tracking-widest text-neutral-500 font-mono">TARGET 30-40s</span>
      </div>

      {/* Big number */}
      <div className="text-center py-3">
        <div className={`font-mono font-bold leading-none ${
          zone === 'over' ? 'text-red-400' :
          zone === 'zone' ? 'text-green-400' :
          zone === 'prep' ? 'text-orange-400' :
          isCountdown ? 'text-orange-300' :
          'text-white'
        }`} style={{ fontSize: '5.5rem' }}>
          {displayValue}
          <span className="text-2xl text-neutral-500 ml-2 align-top mt-4 inline-block">s</span>
        </div>
      </div>

      {/* Progress bar with 30s / 40s markers */}
      <div className="relative mb-1">
        <div className="h-2 bg-neutral-900 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-100"
            style={{
              width: `${progressPct}%`,
              backgroundColor:
                progressValue >= 40 ? '#ef4444' :
                progressValue >= 30 ? '#22c55e' :
                '#f97316',
            }}
          />
        </div>
        {/* 30s marker at 75% */}
        <div className="absolute top-0 h-2 w-0.5 bg-green-400" style={{ left: '75%' }} />
        {/* 40s marker at 100% */}
        <div className="absolute top-0 h-2 w-0.5 bg-red-400" style={{ left: 'calc(100% - 2px)' }} />
        <div className="flex mt-1 text-[9px] font-mono text-neutral-500">
          <span>0s</span>
          <span className="ml-auto" style={{ marginRight: '22%' }}>30s</span>
          <span>40s</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2 mt-4">
        {isActive ? (
          <button
            onClick={stop}
            className="flex-1 h-14 bg-red-500 text-white font-bold tracking-[0.2em] rounded-lg active:bg-red-600 flex items-center justify-center gap-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <Square className="w-5 h-5 fill-current" /> STOP
          </button>
        ) : (
          <>
            <button
              onClick={start}
              className="flex-1 h-14 bg-orange-500 text-black font-bold tracking-[0.2em] rounded-lg active:bg-orange-600 flex items-center justify-center gap-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <Play className="w-5 h-5 fill-current" /> {finalTime !== null ? 'NEXT SET' : 'START'}
            </button>
            {finalTime !== null && (
              <button
                onClick={clearResult}
                className="w-14 h-14 bg-neutral-900 border border-neutral-800 rounded-lg active:bg-neutral-800 flex items-center justify-center"
                aria-label="Clear"
              >
                <RotateCcw className="w-5 h-5 text-neutral-400" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Sound note */}
      <div className="mt-3 text-[10px] text-neutral-500 text-center flex items-center justify-center gap-1.5">
        <Volume2 className="w-3 h-3" />
        <span>Ring mode on for beeps. Screen stays awake while running.</span>
      </div>
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
  const [editingSet, setEditingSet] = useState(null); // {exerciseIdx, setIdx}
  const [loading, setLoading] = useState(true);
  const [savedFlash, setSavedFlash] = useState(false);

  // Load initial data
  useEffect(() => {
    (async () => {
      const template = (await storage.getTemplate()) || DEFAULT_TEMPLATE;
      const draft = await storage.getDraft();
      setSession(draft || createEmptySession(template));
      const all = await storage.listSessions();
      setSessions(all);
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
  const previousByExercise = useMemo(() => {
    const map = {};
    // sessions is already sorted newest first by listSessions
    const pool = sessions.filter((s) => s.id !== session?.id);
    for (const s of pool) {
      for (const ex of s.exercises || []) {
        if (map[ex.name]) continue; // already found a more recent one
        const isBW = ex.unit === 'bw';
        const withTime = ex.sets.filter((st) => st.time !== '' && parseFloat(st.time) > 0);
        const withReps = ex.sets.filter((st) => st.reps !== '' && parseInt(st.reps) > 0);
        const withWeight = ex.sets.filter((st) => !isBW && !st.bw && st.weight !== '');
        map[ex.name] = {
          date: s.date,
          avgTime: withTime.length > 0 ? withTime.reduce((a, st) => a + parseFloat(st.time), 0) / withTime.length : null,
          avgWeight: withWeight.length > 0 ? withWeight.reduce((a, st) => a + parseFloat(st.weight), 0) / withWeight.length : null,
          totalReps: withReps.length > 0 ? withReps.reduce((a, st) => a + parseInt(st.reps), 0) : null,
          sets: ex.sets.length,
          setData: ex.sets.map((st) => ({
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

  const addExercise = () => {
    setSession((s) => ({
      ...s,
      exercises: [...s.exercises, { name: 'New Exercise', unit: 'kg', superset: false, sets: emptySets(3) }],
    }));
  };

  const deleteExercise = (idx) => {
    if (!confirm('Remove this exercise?')) return;
    setSession((s) => ({ ...s, exercises: s.exercises.filter((_, i) => i !== idx) }));
  };

  const saveCurrentSession = async () => {
    await storage.saveSession(session);
    await storage.clearDraft();
    const all = await storage.listSessions();
    setSessions(all);
    // Save template from current exercise list
    const template = session.exercises.map((e) => ({
      name: e.name, unit: e.unit, sets: e.sets.length, superset: e.superset,
    }));
    await storage.setTemplate(template);
    setSession(createEmptySession(template));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
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
    const template = (await storage.getTemplate()) || DEFAULT_TEMPLATE;
    await storage.clearDraft();
    setSession(createEmptySession(template));
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
        <div className="min-h-screen bg-black pb-32" style={{ fontFamily: 'var(--font-body)' }}>
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

            <div>
              <label className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Muscle Group / Focus</label>
              <input
                type="text"
                value={session.muscleGroup}
                onChange={(e) => updateSession({ muscleGroup: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-800 text-white px-3 h-11 rounded text-sm"
                placeholder="Full body, push, pull, legs..."
              />
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

          {/* Set Timer */}
          <TimerWidget />

          {/* Exercises */}
          <div className="mt-6">
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
                  onEditSet={(setIdx) => setEditingSet({ exerciseIdx: i, setIdx })}
                  onDelete={() => deleteExercise(i)}
                  onRename={(name) => updateExercise(i, { ...ex, name })}
                  onAddSet={() => updateExercise(i, { ...ex, sets: [...ex.sets, { reps: '', weight: '', time: '', failure: false, bw: false }] })}
                  onRemoveSet={() => updateExercise(i, { ...ex, sets: ex.sets.slice(0, -1) })}
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

          {/* Save button */}
          <div className="fixed bottom-0 left-0 right-0 bg-black border-t-2 border-neutral-900 p-3 z-20">
            <button
              onClick={saveCurrentSession}
              className={`w-full h-14 rounded-lg font-bold tracking-[0.2em] flex items-center justify-center gap-2 transition-colors ${savedFlash ? 'bg-green-500 text-black' : 'bg-white text-black active:bg-neutral-200'}`}
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

          {/* Set editor bottom sheet */}
          {editingSet && (
            <SetEditor
              exercise={session.exercises[editingSet.exerciseIdx]}
              setIndex={editingSet.setIdx}
              onChange={(newEx) => updateExercise(editingSet.exerciseIdx, newEx)}
              onClose={() => setEditingSet(null)}
            />
          )}
        </div>
      )}
    </>
  );
}
