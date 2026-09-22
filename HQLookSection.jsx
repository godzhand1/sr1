// Phase 1A HQ look section — extends the existing layered creator with
// the new structured fields (face preset, hair style, facial hair, eye
// colour, glasses, accessory, hat style, body build).  Rendered above
// the legacy Look section so users see the new options first.
import {
  FACE_PRESETS, HAIR_STYLES, FACIAL_HAIR, EYE_COLORS,
  GLASSES_STYLES, ACCESSORIES, HAT_STYLES, BODY_BUILDS,
} from './characterBuilder.js';

function Row({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children, testid, color }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`px-2.5 py-1 text-[11px] font-bold rounded border ${active ? 'border-yellow-400 bg-yellow-500/15 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/70'}`}
      style={color ? { boxShadow: `inset 0 0 0 2px ${color}` } : undefined}
    >{children}</button>
  );
}

function ColorChip({ active, onClick, hex, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`w-6 h-6 rounded border ${active ? 'border-yellow-400 border-2' : 'border-zinc-700'}`}
      style={{ background: hex }}
    />
  );
}

export default function HQLookSection({ build, update }) {
  const isFemale = build.gender === 'female';
  return (
    <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3" data-testid="cc-hq-section">
      <div className="text-[11px] font-black tracking-widest text-purple-300 mb-2">HQ FEATURES</div>

      <Row label="Face Preset">
        {FACE_PRESETS.map(f => (
          <Chip
            key={f.id}
            active={(build.facePreset || 'sharp') === f.id}
            onClick={() => update({ facePreset: f.id })}
            testid={`cc-face-${f.id}`}
          >{f.name}</Chip>
        ))}
      </Row>

      <Row label="Hairstyle">
        {HAIR_STYLES.map(h => (
          <Chip
            key={h.id}
            active={(build.hairStyle || 'fade') === h.id}
            onClick={() => update({ hairStyle: h.id })}
            testid={`cc-hair-${h.id}`}
          >{h.name}</Chip>
        ))}
      </Row>

      {!isFemale && (
        <Row label="Facial Hair">
          {FACIAL_HAIR.map(f => (
            <Chip
              key={f.id}
              active={(build.facialHair || 'stubble') === f.id}
              onClick={() => update({ facialHair: f.id })}
              testid={`cc-facialhair-${f.id}`}
            >{f.name}</Chip>
          ))}
        </Row>
      )}

      <Row label="Eye Color">
        {EYE_COLORS.map(e => (
          <ColorChip
            key={e.id}
            active={(build.eyeColor || 'brown') === e.id}
            onClick={() => update({ eyeColor: e.id })}
            hex={e.hex}
            testid={`cc-eye-${e.id}`}
          />
        ))}
      </Row>

      <Row label="Glasses / Eyewear">
        {GLASSES_STYLES.map(g => (
          <Chip
            key={g.id}
            active={(build.glasses || 'none') === g.id}
            onClick={() => update({ glasses: g.id })}
            testid={`cc-glasses-${g.id}`}
          >{g.name}</Chip>
        ))}
      </Row>

      <Row label="Hat / Headwear">
        {HAT_STYLES.map(h => (
          <Chip
            key={h.id}
            active={(build.hatStyle || 'none') === h.id}
            onClick={() => update({ hatStyle: h.id })}
            testid={`cc-hat-${h.id}`}
          >{h.name}</Chip>
        ))}
      </Row>

      <Row label="Accessory">
        {ACCESSORIES.map(a => (
          <Chip
            key={a.id}
            active={(build.accessory || 'none') === a.id}
            onClick={() => update({ accessory: a.id })}
            testid={`cc-acc-${a.id}`}
          >{a.name}</Chip>
        ))}
      </Row>

      <Row label="Body Build">
        {BODY_BUILDS.map(b => (
          <Chip
            key={b.id}
            active={(build.bodyBuild || 'avg') === b.id}
            onClick={() => update({ bodyBuild: b.id })}
            testid={`cc-build-${b.id}`}
          >{b.name}</Chip>
        ))}
      </Row>

      <div className="text-white/40 text-[9px] italic mt-1">
        HQ features only show on the 3D model — the 2D streetfight uses the legacy sliced sprite system.
      </div>
    </div>
  );
}
