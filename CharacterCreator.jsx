// Character creator UI — layered/sliced system for both genders.
// Edits a build object, previews any pose (every weapon stance uses
// the same layered masters so customizations always match), persists
// to localStorage on Save.
import { useEffect, useMemo, useState } from 'react';
import {
  loadBuild, saveBuild, loadCash, widthScaleFor,
  invalidateSpriteCache, femaleSpriteFor, maleSpriteFor,
} from './characterBuilder.js';
import { areMaleLayersReady } from './layeredRecolor.js';
import { areFemaleLayersReady } from './femaleLayeredRecolor.js';
import { MaleLookSections, MaleClothesSections } from './MaleSections.jsx';
import { FemaleLookSections, FemaleClothesSections } from './FemaleSections.jsx';
import CharacterPreview3D from './CharacterPreview3D.jsx';

// Pose cycle for the preview pane — lets the user verify their outfit
// in every weapon stance + status poses.
const POSE_CYCLE = [
  ['idle', 'IDLE'],
  ['attack', 'ATTACK'],
  ['hit', 'HIT'],
  ['fist_punch', 'PUNCH'],
  ['bat_swing', 'BAT'],
  ['pistol_fire', 'PISTOL'],
  ['tec9_hold', 'TEC-9'],
  ['shotgun_fire', 'SHOTGUN'],
  ['ak47_fire', 'AK-47'],
  ['rpg_hold', 'RPG'],
  ['eat_burger', 'EATING'],
  ['hide_trash', 'HIDING'],
  ['lean_cover', 'COVER'],
];

export default function CharacterCreator({ onClose, onSave }) {
  const [build, setBuild] = useState(() => loadBuild());
  const [cash] = useState(() => loadCash());
  const [tab, setTab] = useState('look');       // look | clothes
  const [poseIdx, setPoseIdx] = useState(0);
  // Re-render once the source master PNGs finish loading; recoloring
  // returns the raw flag-palette URL until then.
  const [posesReady, setPosesReady] = useState(() => areMaleLayersReady() && areFemaleLayersReady());
  useEffect(() => {
    if (posesReady) return undefined;
    const id = setInterval(() => {
      if (areMaleLayersReady() && areFemaleLayersReady()) { setPosesReady(true); }
    }, 100);
    return () => clearInterval(id);
  }, [posesReady]);

  const isFemale = build.gender === 'female';
  const spriteFn = isFemale ? femaleSpriteFor : maleSpriteFor;

  const previews = useMemo(() => {
    invalidateSpriteCache();
    return {
      main:   spriteFn(build, POSE_CYCLE[poseIdx][0]),
      idle:   spriteFn(build, 'idle'),
      attack: spriteFn(build, 'attack'),
      hit:    spriteFn(build, 'hit'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, posesReady, isFemale, poseIdx]);

  const widthScale = widthScaleFor(build);
  const update = (patch) => setBuild(b => ({ ...b, ...patch }));

  const save = () => {
    saveBuild(build);
    invalidateSpriteCache();
    onSave?.(build);
  };

  return (
    <div
      className="fixed inset-0 z-[201] bg-black/90 flex flex-col items-center overflow-y-auto"
      style={{ touchAction: 'manipulation' }}
      data-testid="streetfight-char-creator"
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-white/70 hover:text-white text-xs bg-black/40 border border-white/15 px-2 py-1 rounded"
        data-testid="cc-close"
      >✕</button>

      <div className="max-w-4xl w-full p-4 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h1 className="text-white text-2xl font-black tracking-widest">CREATE YOUR SAINT</h1>
          <div className="flex items-center gap-2">
            <div className="bg-green-700/30 border border-green-500/40 text-green-200 px-3 py-1 rounded text-xs font-bold">
              <span className="opacity-70">$</span> {cash.toLocaleString()}
            </div>
            <button
              onClick={() => setTab('look')}
              className={`px-3 py-1 text-xs font-bold tracking-widest rounded ${tab === 'look' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-white/70'}`}
              data-testid="cc-tab-look"
            >LOOK</button>
            <button
              onClick={() => setTab('clothes')}
              className={`px-3 py-1 text-xs font-bold tracking-widest rounded ${tab === 'clothes' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-white/70'}`}
              data-testid="cc-tab-clothes"
            >CLOTHES</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-5">
          {/* Preview pane — sticky so it stays visible while scrolling toggles */}
          <div className="sm:sticky sm:top-4 self-start bg-zinc-900 border border-zinc-700 rounded-lg p-3 flex flex-col items-center">
            {/* Live 3D preview of the equipped Saint — same SaintModel
                + skinned OBJ that the brawl uses, rotating slowly so
                every angle is visible while customising. */}
            <CharacterPreview3D build={build} size={220} />
            <div className="text-[9px] tracking-widest text-purple-300 mt-1 mb-2 font-bold">3D PREVIEW</div>
            <img
              src={previews.main}
              alt="preview"
              className="w-28 h-36 sm:w-32 sm:h-40 object-contain"
              style={{ imageRendering: 'pixelated', transform: `scaleX(${widthScale})` }}
              data-testid="cc-preview-main"
            />
            <div className="flex items-center justify-between w-full mt-2">
              <button
                onClick={() => setPoseIdx(i => (i - 1 + POSE_CYCLE.length) % POSE_CYCLE.length)}
                className="text-white/70 hover:text-white px-2 py-1 bg-black/40 border border-white/15 rounded text-xs"
                data-testid="cc-pose-prev"
              >◀</button>
              <div className="text-yellow-300 text-[10px] font-bold tracking-widest" data-testid="cc-pose-label">
                {POSE_CYCLE[poseIdx][1]}
              </div>
              <button
                onClick={() => setPoseIdx(i => (i + 1) % POSE_CYCLE.length)}
                className="text-white/70 hover:text-white px-2 py-1 bg-black/40 border border-white/15 rounded text-xs"
                data-testid="cc-pose-next"
              >▶</button>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-3 w-full">
              <Mini label="IDLE"   src={previews.idle}   scale={widthScale} testid="cc-preview-idle" />
              <Mini label="ATTACK" src={previews.attack} scale={widthScale} testid="cc-preview-attack" />
              <Mini label="HIT"    src={previews.hit}    scale={widthScale} testid="cc-preview-hit" />
            </div>
            <div className="text-white/40 text-[8px] italic mt-2 text-center">
              Your outfit carries into every weapon stance — flip through the poses to check.
            </div>
          </div>

          {/* Right pane */}
          <div className="space-y-4">
            <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-2">Gender</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => update({ gender: 'male' })}
                  className={`px-3 py-2 text-xs font-bold rounded border ${!isFemale ? 'border-yellow-400 bg-yellow-500/10 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/70'}`}
                  data-testid="cc-gender-male"
                >MALE</button>
                <button
                  onClick={() => update({ gender: 'female' })}
                  className={`px-3 py-2 text-xs font-bold rounded border ${isFemale ? 'border-pink-400 bg-pink-500/10 text-pink-200' : 'border-zinc-700 bg-zinc-900 text-white/70'}`}
                  data-testid="cc-gender-female"
                >FEMALE</button>
              </div>
            </div>
            {tab === 'look' && (
              isFemale
                ? <FemaleLookSections build={build} update={update} />
                : <MaleLookSections build={build} update={update} />
            )}
            {tab === 'clothes' && (isFemale
              ? <FemaleClothesSections build={build} update={update} />
              : <MaleClothesSections build={build} update={update} />)}
          </div>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-3 bg-zinc-800 text-white/70 tracking-widest rounded border border-zinc-700"
            data-testid="cc-cancel"
          >CANCEL</button>
          <button
            onClick={save}
            className="px-5 py-3 bg-yellow-400 text-black font-black tracking-widest rounded"
            data-testid="cc-save"
          >SAVE & PLAY</button>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, src, scale, testid }) {
  return (
    <div className="text-center">
      <img
        src={src}
        alt={label}
        className="w-full aspect-square object-contain bg-black/40 rounded"
        style={{ imageRendering: 'pixelated', transform: `scaleX(${scale})` }}
        data-testid={testid}
      />
      <div className="text-[8px] text-white/50 mt-0.5">{label}</div>
    </div>
  );
}
