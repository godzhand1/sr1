// PbrMaterialPanel.jsx — editor UI for the Principled-BSDF material library.
//   <PbrMaterialField>  inspector block: pick a library material for a
//                       box / ramp / hill / the floor, tune tile /
//                       triplanar / parallax / normal strength.
//   <PbrLibraryModal>   browse the library, generate a set from an
//                       albedo, upload an authored set, delete.
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { absUrl } from '../brawl3d/pbrLibrary.js';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const MAP_SLOTS = ['albedo', 'normal', 'roughness', 'metallic', 'ao', 'height'];

function authHeaders() {
  const token = localStorage.getItem('sr_community_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const row = 'flex items-center gap-2 text-[10px] text-white/70';
const sel = 'flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] text-white';
const num = 'w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-white text-[11px]';

export function PbrMaterialField({ value, onChange, catalog, size, onOpenLibrary, testid = 'pbr', title = 'PBR MATERIAL', allowAuto = true }) {
  const ref = value || {};
  const def = catalog.find((m) => m.id === ref.materialId) || null;
  const set = (patch) => onChange({ ...ref, ...patch });
  const biggest = Math.max(size?.w || 0, size?.h || 0, size?.d || 0);
  const groups = catalog.reduce((acc, m) => { (acc[m.category] ||= []).push(m); return acc; }, {});
  return (
    <div className="space-y-1.5 border border-slate-800 rounded p-1.5 bg-slate-950/40" data-testid={`${testid}-block`}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-widest text-lime-400">{title}</span>
        <button onClick={onOpenLibrary} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-lime-300" data-testid={`${testid}-open-library`}>LIBRARY…</button>
      </div>
      <label className={row}>
        {def?.maps?.thumb && <img src={absUrl(def.maps.thumb)} alt="" className="w-8 h-8 rounded object-cover border border-slate-700" data-testid={`${testid}-thumb`} />}
        <select
          value={ref.materialId || ''}
          onChange={(e) => (e.target.value ? set({ materialId: e.target.value }) : onChange(null))}
          className={sel}
          data-testid={`${testid}-material`}
        >
          <option value="">(flat colour)</option>
          {Object.entries(groups).map(([cat, list]) => (
            <optgroup key={cat} label={cat.toUpperCase()}>
              {list.map((m) => <option key={m.id} value={m.id}>{`${m.name} · ${m.preset}`}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {def && (
        <>
          <label className={row}>
            <span className="w-16 shrink-0">TILE (m)</span>
            <input type="number" step={0.25} min={0.1} value={ref.tile ?? def.params?.tile ?? 2} onChange={(e) => set({ tile: Math.max(0.1, parseFloat(e.target.value) || 2) })} className={num} data-testid={`${testid}-tile`} />
            <span className="text-white/40">world-space repeat</span>
          </label>
          <label className={row}>
            <span className="w-16 shrink-0">TRIPLANAR</span>
            <select value={ref.triplanar || (allowAuto ? 'auto' : 'on')} onChange={(e) => set({ triplanar: e.target.value })} className={sel} data-testid={`${testid}-triplanar`}>
              {allowAuto && <option value="auto">{`auto (${biggest >= 6 ? 'on — large surface' : 'off — small prop'})`}</option>}
              <option value="on">on — box mapping, no stretch</option>
              <option value="off">off — UV tiling</option>
            </select>
          </label>
          <label className={row}>
            <input type="checkbox" checked={ref.parallax?.enabled ?? (biggest >= 12)} onChange={(e) => set({ parallax: { ...(ref.parallax || {}), enabled: e.target.checked } })} data-testid={`${testid}-parallax`} />
            <span className="w-14 shrink-0">PARALLAX</span>
            <input type="number" step={0.005} min={0} max={0.2} value={ref.parallax?.scale ?? def.params?.parallax?.scale ?? 0.03} onChange={(e) => set({ parallax: { ...(ref.parallax || {}), scale: Math.max(0, parseFloat(e.target.value) || 0) } })} className={num} data-testid={`${testid}-parallax-scale`} />
            <span className="text-white/40">depth (m)</span>
          </label>
          <label className={row}>
            <span className="w-16 shrink-0">NORMAL</span>
            <input type="range" min={0} max={3} step={0.05} value={ref.normalScale ?? def.params?.normalScale ?? 1} onChange={(e) => set({ normalScale: parseFloat(e.target.value) })} className="flex-1" data-testid={`${testid}-normal`} />
            <span className="w-8 text-right font-mono">{(ref.normalScale ?? def.params?.normalScale ?? 1).toFixed(2)}</span>
          </label>
          <label className={row}>
            <span className="w-16 shrink-0">TINT</span>
            <input type="color" value={ref.tint || '#ffffff'} onChange={(e) => set({ tint: e.target.value })} className="w-8 h-6 rounded border border-slate-700 bg-slate-900" data-testid={`${testid}-tint`} />
            <span className="font-mono text-white/50">{ref.tint || '#ffffff'}</span>
            {ref.tint && <button onClick={() => set({ tint: undefined })} className="text-[9px] text-white/50 hover:text-white">reset</button>}
          </label>
          <div className="text-[9px] text-white/40">{def.preset} · {def.size?.[0]}×{def.size?.[1]} · albedo + normal + ORM + height</div>
        </>
      )}
    </div>
  );
}

export function PbrLibraryModal({ open, onClose, catalog, presets, onRefresh }) {
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('concrete');
  const [category, setCategory] = useState('custom');
  const [tile, setTile] = useState(2);
  const files = useRef({});
  const [picked, setPicked] = useState({});
  useEffect(() => { if (!open) { files.current = {}; setPicked({}); setName(''); } }, [open]);
  if (!open) return null;

  const create = async () => {
    if (!files.current.albedo) { toast.error('Pick an albedo image first.'); return; }
    if (!name.trim()) { toast.error('Give the material a name.'); return; }
    setBusy('Generating maps…');
    try {
      const fd = new FormData();
      fd.append('name', name.trim()); fd.append('preset', preset); fd.append('category', category); fd.append('tile', String(tile));
      for (const k of MAP_SLOTS) if (files.current[k]) fd.append(k, files.current[k]);
      const res = await fetch(`${BACKEND}/api/mapedit/pbr/materials`, { method: 'POST', headers: authHeaders(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || `HTTP ${res.status}`);
      toast.success(`Material "${j.material.name}" ready (${j.material.source})`);
      files.current = {}; setPicked({}); setName('');
      await onRefresh();
    } catch (e) { toast.error(`Material build failed: ${e.message}`); }
    finally { setBusy(''); }
  };
  const remove = async (m) => {
    if (!window.confirm(`Delete "${m.name}"?`)) return;
    const res = await fetch(`${BACKEND}/api/mapedit/pbr/materials/${m.id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.detail || 'Delete failed'); return; }
    toast.success('Deleted'); await onRefresh();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" data-testid="pbr-library-modal" onClick={onClose}>
      <div className="bg-slate-950 border border-slate-700 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div className="text-xs font-bold tracking-widest text-lime-400">PBR MATERIAL LIBRARY <span className="text-white/40 font-normal">· {catalog.length} sets · Principled BSDF (albedo / normal / roughness / metallic / AO / height)</span></div>
          <div className="flex items-center gap-2">
            <a href={`${BACKEND}/api/mapedit/pbr/blender-addon`} className="text-[10px] px-2 py-1 rounded bg-indigo-800 hover:bg-indigo-700" data-testid="pbr-blender-addon-link" download>BLENDER ADD-ON</a>
            <button onClick={onClose} className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700" data-testid="pbr-library-close">CLOSE</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-[1fr_300px]">
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 content-start" data-testid="pbr-library-grid">
            {catalog.map((m) => (
              <div key={m.id} className="border border-slate-800 rounded overflow-hidden bg-slate-900/60" data-testid={`pbr-card-${m.id}`}>
                <div className="grid grid-cols-2">
                  <img src={absUrl(m.maps.thumb)} alt="" className="w-full aspect-square object-cover" />
                  <div className="grid grid-cols-2">
                    {['normal', 'orm', 'height', 'roughness'].map((k) => m.maps[k] && (
                      <img key={k} src={absUrl(m.maps[k])} alt={k} title={k} className="w-full aspect-square object-cover" loading="lazy" />
                    ))}
                  </div>
                </div>
                <div className="p-1.5">
                  <div className="text-[10px] font-bold text-white truncate">{m.name}</div>
                  <div className="text-[9px] text-white/50">{m.category} · {m.preset} · {m.size?.[0]}×{m.size?.[1]} · tile {m.params?.tile}m</div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-white/40">{m.source}</span>
                    {m.source !== 'seed' && <button onClick={() => remove(m)} className="text-[9px] text-red-400 hover:text-red-300" data-testid={`pbr-delete-${m.id}`}>delete</button>}
                  </div>
                </div>
              </div>
            ))}
            {!catalog.length && <div className="text-[11px] text-white/50 col-span-full">Library is empty — the server seeds the bundled set on boot.</div>}
          </div>
          <div className="border-l border-slate-800 p-3 space-y-2 text-[10px] text-white/70" data-testid="pbr-create-form">
            <div className="text-[10px] font-bold tracking-widest text-amber-400">NEW MATERIAL</div>
            <div className="text-[9px] text-white/40">Drop an albedo and the server derives normal · roughness · AO · height · metallic. Add your own maps to override any slot.</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${sel} w-full`} data-testid="pbr-new-name" />
            <label className={row}><span className="w-14">PRESET</span>
              <select value={preset} onChange={(e) => setPreset(e.target.value)} className={sel} data-testid="pbr-new-preset">
                {(presets || []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className={row}><span className="w-14">CATEGORY</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel} data-testid="pbr-new-category">
                {['ground', 'wall', 'stadium', 'metal', 'custom'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={row}><span className="w-14">TILE (m)</span>
              <input type="number" step={0.25} min={0.1} value={tile} onChange={(e) => setTile(parseFloat(e.target.value) || 2)} className={num} data-testid="pbr-new-tile" />
            </label>
            {MAP_SLOTS.map((k) => (
              <label key={k} className={`${row} justify-between`}>
                <span className={`w-16 ${k === 'albedo' ? 'text-lime-300 font-bold' : ''}`}>{k.toUpperCase()}{k === 'albedo' ? ' *' : ''}</span>
                <input type="file" accept="image/*" onChange={(e) => { files.current[k] = e.target.files?.[0] || null; setPicked((p) => ({ ...p, [k]: files.current[k]?.name || '' })); }} className="hidden" id={`pbr-file-${k}`} data-testid={`pbr-new-${k}`} />
                <label htmlFor={`pbr-file-${k}`} className="flex-1 truncate text-right cursor-pointer px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700">{picked[k] || (k === 'albedo' ? 'choose image…' : 'generate')}</label>
              </label>
            ))}
            <button onClick={create} disabled={!!busy} className="w-full px-2 py-1.5 rounded bg-lime-600 hover:bg-lime-500 text-black font-bold disabled:opacity-50" data-testid="pbr-new-create">{busy || 'BUILD MATERIAL'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
