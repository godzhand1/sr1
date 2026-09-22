// Team Gangsta Brawl — quick lobby creator.
//
// A tiny inline dialog spawned from the TGB menu. Wraps the same
// `POST /api/streetfight/lobbies` endpoint the community sidebar uses,
// but hardcodes `game: 'brawl3d'` and defaults `mission: 'brawl'` so
// the player lands straight into a hostable brawl3d room.
//
// On success we dispatch `sr:open-brawl3d` with the new lobby_id —
// App.js re-mounts Brawl3DGame with it and drops the user into the
// arena. Everyone else discovers the lobby via `GET /lobbies` (the
// browser refresh cadence in the community sidebar / matchmaker).

import { useState } from 'react';

const PRIVACY_OPTIONS = [
  { id: 'open',    label: 'OPEN',    desc: 'anyone can join' },
  { id: 'friends', label: 'FRIENDS', desc: 'only your friends' },
  { id: 'gang',    label: 'GANG',    desc: 'gang-only lobby' },
  { id: 'invite',  label: 'INVITE',  desc: 'only invited players' },
];

const MISSION_OPTIONS = [
  { id: 'brawl',           label: 'GANGSTA BRAWL', desc: 'TDM / KOTH arena' },
  { id: 'lobby_warehouse', label: 'THE WAREHOUSE', desc: 'chill hangout — no combat' },
];

export function CreateLobbyModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('MY BRAWL');
  const [privacy, setPrivacy] = useState('open');
  const [mission, setMission] = useState('brawl');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;

  const submit = async () => {
    setErr('');
    const trimmed = (name || '').trim();
    if (!trimmed) { setErr('Give it a name.'); return; }
    const API = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem('sr_community_token');
    if (!API || !token) { setErr('sign in first'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/streetfight/lobbies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: trimmed.slice(0, 40),
          mission,
          privacy,
          game: 'brawl3d',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail || `Create failed (${res.status})`);
        return;
      }
      const j = await res.json();
      onCreated?.(j);
    } catch {
      setErr('offline — try again in a sec');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" data-testid="brawl3d-create-lobby-modal">
      <div className="bg-zinc-950 border border-yellow-500/40 rounded-lg w-full max-w-md p-5">
        <div className="flex justify-between items-baseline mb-4">
          <div>
            <div className="text-yellow-400 text-[10px] font-bold tracking-widest">HOST A LOBBY</div>
            <div className="text-white font-black text-xl">CREATE LOBBY</div>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xs px-2 py-1 border border-white/20 rounded"
            data-testid="brawl3d-create-lobby-close"
          >CLOSE</button>
        </div>

        <label className="block text-white/60 uppercase text-[10px] tracking-widest mb-1">Lobby Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="e.g. westside crew night"
          className="w-full bg-zinc-900 border border-zinc-700 focus:border-yellow-400 outline-none text-white text-sm px-3 py-2 rounded mb-4"
          data-testid="brawl3d-create-lobby-name"
        />

        <div className="text-white/60 uppercase text-[10px] tracking-widest mb-1">Mission</div>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {MISSION_OPTIONS.map(m => (
            <button
              key={m.id}
              onClick={() => setMission(m.id)}
              className={`px-3 py-2 text-left rounded border text-xs ${mission === m.id ? 'border-yellow-400 bg-yellow-500/15 text-yellow-100' : 'border-zinc-700 bg-zinc-900 text-white/60'}`}
              data-testid={`brawl3d-create-lobby-mission-${m.id}`}
            >
              <div className="font-black tracking-widest">{m.label}</div>
              <div className="text-[10px] text-white/40 mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>

        <div className="text-white/60 uppercase text-[10px] tracking-widest mb-1">Privacy</div>
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          {PRIVACY_OPTIONS.map(p => (
            <button
              key={p.id}
              onClick={() => setPrivacy(p.id)}
              className={`px-3 py-2 text-left rounded border text-xs ${privacy === p.id ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100' : 'border-zinc-700 bg-zinc-900 text-white/60'}`}
              data-testid={`brawl3d-create-lobby-privacy-${p.id}`}
            >
              <div className="font-black tracking-widest">{p.label}</div>
              <div className="text-[10px] text-white/40 mt-0.5">{p.desc}</div>
            </button>
          ))}
        </div>

        {err && (
          <div className="text-red-400 text-[11px] mb-3" data-testid="brawl3d-create-lobby-err">{err}</div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className={`w-full py-3 font-black tracking-widest rounded ${busy ? 'bg-yellow-500/40 cursor-wait text-black/60' : 'bg-yellow-400 hover:bg-yellow-300 text-black'}`}
          data-testid="brawl3d-create-lobby-submit"
        >{busy ? 'CREATING…' : '▶ CREATE & JOIN'}</button>
      </div>
    </div>
  );
}
