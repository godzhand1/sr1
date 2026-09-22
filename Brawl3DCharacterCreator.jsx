// Team Gangsta Brawl — dedicated 3D character creator.
//
// Separated from the 2D Stilwater Streets creator per user request:
// here the experience is built around the LIVE 3D preview (large,
// orbit-controllable on mouse / wheel / gamepad right-stick) instead
// of the 2D sprite stack. Same SaintModel + skinning pipeline as the
// in-game brawl so the dressed Saint matches what spawns in the match
// frame-for-frame.
//
// Builds persist to `sr_brawl3d_build` (separate from the 2D game's
// `sr_streetfight_build`).

import { useState, useEffect } from 'react';
import { loadBrawl3DBuild, saveBrawl3DBuild, loadCash, invalidateSpriteCache } from '../streetfight/characterBuilder.js';
import { MaleLookSections, MaleClothesSections } from '../streetfight/MaleSections.jsx';
import { FemaleLookSections, FemaleClothesSections } from '../streetfight/FemaleSections.jsx';
import Brawl3DCharacterPreview from './Brawl3DCharacterPreview.jsx';
import { getCharSource, setCharSource } from './characterSource.js';
import { resetMeshyTemplateCache } from './characterMeshy.js';
import { hasCustomCharacter } from './customCharacterStore.js';

// Pose options drive the live preview's animation state so the player
// can see how their outfit looks while sprinting, crouching, firing.
const POSES = [
  { id: 'idle',         label: 'IDLE' },
  { id: 'walk',         label: 'WALK' },
  { id: 'sprint',       label: 'SPRINT' },
  { id: 'crouch',       label: 'CROUCH' },
  { id: 'fire',         label: 'FIRE' },
  { id: 'crouch_fire',  label: 'CROUCH FIRE' },
];

export default function Brawl3DCharacterCreator({ onClose, onSave }) {
  const [build, setBuild] = useState(() => loadBrawl3DBuild());
  const [cash] = useState(() => loadCash());
  const [tab, setTab] = useState('look');
  const [pose, setPose] = useState('idle');
  const [source, setSource] = useState(() => getCharSource());
  const [customExists, setCustomExists] = useState(false);
  useEffect(() => {
    hasCustomCharacter().then((ok) => setCustomExists(!!ok)).catch(() => setCustomExists(false));
  }, []);

  const isFemale = build.gender === 'female';
  const update = (patch) => setBuild(b => ({ ...b, ...patch }));

  const pickSource = (s) => {
    setSource(s);
    setCharSource(s);
    // Invalidate the shared cache so the next spawn re-loads from
    // the newly-chosen source without a page refresh.
    resetMeshyTemplateCache();
  };

  const save = () => {
    saveBrawl3DBuild(build);
    invalidateSpriteCache();
    onSave?.(build);
  };

  return (
    <div
      className="fixed inset-0 z-[201] bg-black/95 flex flex-col items-center overflow-y-auto"
      style={{ touchAction: 'manipulation' }}
      data-testid="brawl3d-char-creator"
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-white/70 hover:text-white text-xs bg-black/40 border border-white/15 px-2 py-1 rounded z-10"
        data-testid="brawl3d-cc-close"
      >✕</button>

      <div className="max-w-6xl w-full p-4 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h1 className="text-white text-2xl sm:text-3xl font-black tracking-widest">CREATE YOUR SAINT — 3D BRAWL</h1>
            <div className="text-purple-300/70 text-[10px] font-bold tracking-widest mt-1">
              Separate from the 2D Stilwater Streets Saint.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-green-700/30 border border-green-500/40 text-green-200 px-3 py-1 rounded text-xs font-bold">
              <span className="opacity-70">$</span> {cash.toLocaleString()}
            </div>
            <button
              onClick={() => setTab('look')}
              className={`px-3 py-1 text-xs font-bold tracking-widest rounded ${tab === 'look' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-white/70'}`}
              data-testid="brawl3d-cc-tab-look"
            >LOOK</button>
            <button
              onClick={() => setTab('clothes')}
              className={`px-3 py-1 text-xs font-bold tracking-widest rounded ${tab === 'clothes' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-white/70'}`}
              data-testid="brawl3d-cc-tab-clothes"
            >CLOTHES</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[480px_1fr] gap-6">
          {/* Big 3D preview pane — orbit-controllable. */}
          <div className="lg:sticky lg:top-4 self-start flex flex-col gap-3">
            <Brawl3DCharacterPreview build={build} width={480} height={600} pose={pose} />
            <div className="flex flex-wrap gap-1.5 justify-center" data-testid="brawl3d-cc-poses">
              {POSES.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPose(p.id)}
                  className={`px-2.5 py-1 text-[10px] font-bold tracking-wider rounded border ${pose === p.id ? 'bg-yellow-400 text-black border-yellow-300' : 'bg-zinc-900 text-white/70 border-zinc-700'}`}
                  data-testid={`brawl3d-cc-pose-${p.id}`}
                >{p.label}</button>
              ))}
            </div>
            <div className="text-white/40 text-[10px] text-center tracking-wider">
              Customize the same Saint that spawns in Team Gangsta Brawl. Orbit the camera to inspect every angle.
            </div>
          </div>

          {/* Right pane — body-source + gender + tab content. */}
          <div className="space-y-4">
            <div
              className="bg-zinc-950/60 border border-zinc-800 rounded p-3"
              data-testid="brawl3d-cc-body-source"
            >
              <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-2">Body source</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => pickSource('default')}
                  className={`px-3 py-2 text-xs font-bold rounded border text-left ${source === 'default' ? 'border-yellow-400 bg-yellow-500/10 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/70'}`}
                  data-testid="brawl3d-cc-source-default"
                >
                  <div>CUSTOMIZABLE CHARACTER</div>
                  <div className="text-[9px] font-normal opacity-70 mt-0.5">Default body + your look/clothes.</div>
                </button>
                <button
                  onClick={() => pickSource('custom')}
                  disabled={!customExists}
                  className={`px-3 py-2 text-xs font-bold rounded border text-left transition ${source === 'custom' ? 'border-pink-400 bg-pink-500/10 text-pink-200' : 'border-zinc-700 bg-zinc-900 text-white/70'} ${!customExists ? 'opacity-40 cursor-not-allowed' : ''}`}
                  data-testid="brawl3d-cc-source-custom"
                >
                  <div>MY CUSTOM GLB</div>
                  <div className="text-[9px] font-normal opacity-70 mt-0.5">
                    {customExists ? 'Use your Rig Lab character.' : 'Rig one in Rig Lab first.'}
                  </div>
                </button>
              </div>
              {!customExists && (
                <a
                  href="/rig-lab"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[10px] font-bold tracking-widest text-cyan-300 hover:text-cyan-200"
                  data-testid="brawl3d-cc-source-open-riglab"
                >
                  → OPEN RIG LAB
                </a>
              )}
            </div>
            <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-2">Gender</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => update({ gender: 'male' })}
                  className={`px-3 py-2 text-xs font-bold rounded border ${!isFemale ? 'border-yellow-400 bg-yellow-500/10 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/70'}`}
                  data-testid="brawl3d-cc-gender-male"
                >MALE</button>
                <button
                  onClick={() => update({ gender: 'female' })}
                  className={`px-3 py-2 text-xs font-bold rounded border ${isFemale ? 'border-pink-400 bg-pink-500/10 text-pink-200' : 'border-zinc-700 bg-zinc-900 text-white/70'}`}
                  data-testid="brawl3d-cc-gender-female"
                >FEMALE</button>
              </div>
            </div>
            {tab === 'look' && (
              isFemale
                ? <FemaleLookSections build={build} update={update} />
                : <MaleLookSections build={build} update={update} />
            )}
            {tab === 'clothes' && (isFemale
              ? <>
                  <FemaleClothesSections build={build} update={update} />
                  <div className="bg-purple-950/40 border border-purple-700/40 rounded p-3 mt-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-purple-300 mb-2">
                      UNISEX OPTIONS — male clothing items also wearable
                    </div>
                    <MaleClothesSections build={build} update={update} />
                  </div>
                </>
              : <MaleClothesSections build={build} update={update} />)}
          </div>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-3 bg-zinc-800 text-white/70 tracking-widest rounded border border-zinc-700"
            data-testid="brawl3d-cc-cancel"
          >CANCEL</button>
          <button
            onClick={save}
            className="px-5 py-3 bg-yellow-400 text-black font-black tracking-widest rounded"
            data-testid="brawl3d-cc-save"
          >SAVE & PLAY</button>
        </div>
      </div>
    </div>
  );
}
