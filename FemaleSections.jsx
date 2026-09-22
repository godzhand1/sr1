// FEMALE creator sections — granular layered toggles (Phase A modular).
import { SKIN_TONES, BODY_TYPES, BOOB_SIZES, FEMALE_RACES, FEMALE_STYLE_PRESETS } from './characterBuilder.js';
import { SR_CLOTHING } from '../brawl3d/srClothing.js';
import { Section, Toggle, Swatches, ModeRow, SubLabel } from './CreatorControls.jsx';

function SrSlot({ label, slot, value, onChange, testid }) {
  const options = SR_CLOTHING[slot] || [];
  return (
    <div className="mb-2">
      <SubLabel>{label}</SubLabel>
      <select
        value={value || 'none'}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 text-white/85 text-xs font-bold rounded px-2 py-1.5 mt-1"
        data-testid={testid}
      >
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}

export function FemaleLookSections({ build, update }) {
  return (
    <>
      <Section title="Race">
        <ModeRow
          options={FEMALE_RACES}
          value={build.femRace}
          onChange={(id) => update({ femRace: id, skinId: FEMALE_RACES.find(r => r.id === id).skinDefault })}
          testPrefix="cc-fem-race"
          accent="pink"
        />
      </Section>

      <Section title="Skin Tone">
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
          {SKIN_TONES.map(s => (
            <button
              key={s.id}
              onClick={() => update({ skinId: s.id })}
              title={s.name}
              className={`aspect-square rounded border-2 ${build.skinId === s.id ? 'border-pink-400' : 'border-zinc-700'}`}
              style={{ background: s.hex }}
              data-testid={`cc-fem-skin-${s.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="Body Type">
        <ModeRow options={BODY_TYPES} value={build.bodyType || 'avg'} onChange={(id) => update({ bodyType: id })} testPrefix="cc-f-body" accent="pink" />
      </Section>

      <Section title="Boob Size">
        <ModeRow options={BOOB_SIZES} value={build.fBoobs || 'med'} onChange={(id) => update({ fBoobs: id })} testPrefix="cc-f-boobs" accent="pink" />
      </Section>

      <Section title="Braids Color">
        <Swatches value={build.fHairHex} onPick={hex => update({ fHairHex: hex })} testPrefix="cc-f-hair" accent="pink" />
      </Section>

      <Section title="SR Vanilla Head Assets">
        <SrSlot label="HAIR"        slot="hair"       value={build.srHair}       onChange={id => update({ srHair: id })}       testid="cc-f-sr-hair"   />
        <SrSlot label="FACIAL HAIR" slot="facialHair" value={build.srFacialHair} onChange={id => update({ srFacialHair: id })} testid="cc-f-sr-fhair"  />
        <SrSlot label="HAT"         slot="hat"        value={build.srHat}        onChange={id => update({ srHat: id })}        testid="cc-f-sr-hat"    />
        <SrSlot label="GLASSES"     slot="glasses"    value={build.srGlasses}    onChange={id => update({ srGlasses: id })}    testid="cc-f-sr-glasses"/>
      </Section>
    </>
  );
}

export function FemaleClothesSections({ build, update }) {
  return (
    <>
      <Section title="90s Style Presets">
        <div className="grid grid-cols-3 gap-1.5">
          {FEMALE_STYLE_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => update(p.patch)}
              className="px-2 py-2 text-[10px] font-bold rounded border border-zinc-600 bg-zinc-900 text-white/80 hover:border-pink-400"
              data-testid={`cc-f-preset-${p.id}`}
            >{p.name}</button>
          ))}
        </div>
      </Section>

      <Section title="SR Vanilla Wardrobe">
        <SrSlot label="PANTS"   slot="pants"  value={build.srPants}  onChange={id => update({ srPants:  id })} testid="cc-f-sr-pants"  />
        <SrSlot label="SHIRT"   slot="shirt"  value={build.srShirt}  onChange={id => update({ srShirt:  id })} testid="cc-f-sr-shirt"  />
        <SrSlot label="JACKET"  slot="jacket" value={build.srJacket} onChange={id => update({ srJacket: id })} testid="cc-f-sr-jacket" />
        <SrSlot label="SHOES"   slot="shoes"  value={build.srShoes}  onChange={id => update({ srShoes:  id })} testid="cc-f-sr-shoes"  />
      </Section>

      <Section title="Head">
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle label="BANDANA" on={build.fBandanaOn !== false} onClick={() => update({ fBandanaOn: !(build.fBandanaOn !== false) })} testid="cc-f-bandana" accent="pink" />
          <Toggle label="FACE MASK" on={!!build.fMaskOn} onClick={() => update({ fMaskOn: !build.fMaskOn })} testid="cc-f-mask" accent="pink" />
        </div>
        {build.fBandanaOn !== false && (
          <>
            <SubLabel>BANDANA COLOR</SubLabel>
            <Swatches value={build.fBandanaHex} onPick={hex => update({ fBandanaHex: hex })} testPrefix="cc-f-bandana-c" accent="pink" />
          </>
        )}
        {!!build.fMaskOn && (
          <>
            <SubLabel>MASK COLOR</SubLabel>
            <Swatches value={build.fMaskHex} onPick={hex => update({ fMaskHex: hex })} testPrefix="cc-f-mask-c" accent="pink" />
          </>
        )}
        <SubLabel>CAP</SubLabel>
        <ModeRow
          options={[{ id: 'off', name: 'None' }, { id: 'straight', name: 'Straight' }, { id: 'back', name: 'Backwards' }, { id: 'side', name: 'Sideways' }]}
          value={build.fCapMode || 'off'}
          onChange={(id) => update({ fCapMode: id })}
          testPrefix="cc-f-cap"
          accent="pink"
        />
        {build.fCapMode && build.fCapMode !== 'off' && (
          <Swatches value={build.fCapHex} onPick={hex => update({ fCapHex: hex })} testPrefix="cc-f-cap-c" accent="pink" />
        )}
      </Section>

      <Section title="Upper Body">
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle label="GOLD JEWELRY" on={build.fChainOn !== false} onClick={() => update({ fChainOn: !(build.fChainOn !== false) })} testid="cc-f-chain" accent="pink" />
          <Toggle label="BRA" on={build.fBraOn !== false} onClick={() => update({ fBraOn: !(build.fBraOn !== false) })} testid="cc-f-bra" accent="pink" />
          <Toggle label="SR1 BRA (CS_BRA)" on={!!build.fCsBraOn} onClick={() => update({ fCsBraOn: !build.fCsBraOn })} testid="cc-f-csbra" accent="pink" />
          <Toggle label="OPEN SHIRT" on={build.fShirtOn !== false} onClick={() => update({ fShirtOn: !(build.fShirtOn !== false) })} testid="cc-f-shirt" accent="pink" />
        </div>
        {build.fBraOn !== false && (
          <>
            <SubLabel>BRA COLOR</SubLabel>
            <Swatches value={build.fBraHex} onPick={hex => update({ fBraHex: hex })} testPrefix="cc-f-bra-c" accent="pink" />
          </>
        )}
        {build.fShirtOn !== false && (
          <>
            <SubLabel>SHIRT COLOR</SubLabel>
            <Swatches value={build.fShirtHex} onPick={hex => update({ fShirtHex: hex })} testPrefix="cc-f-shirt-c" accent="pink" />
          </>
        )}
      </Section>

      <Section title="Lower Body">
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle label="PANTS" on={build.fPantsOn !== false} onClick={() => update({ fPantsOn: !(build.fPantsOn !== false) })} testid="cc-f-pants" accent="pink" />
          <Toggle label="THONG SHOWING" on={build.fThongOn !== false} onClick={() => update({ fThongOn: !(build.fThongOn !== false) })} testid="cc-f-thong" accent="pink" />
        </div>
        {build.fThongOn !== false && (
          <>
            <SubLabel>THONG COLOR</SubLabel>
            <Swatches value={build.fThongHex} onPick={hex => update({ fThongHex: hex })} testPrefix="cc-f-thong-c" accent="pink" />
          </>
        )}
        {build.fPantsOn !== false && (
          <>
            <SubLabel>PANTS COLOR</SubLabel>
            <Swatches value={build.fPantsHex} onPick={hex => update({ fPantsHex: hex })} testPrefix="cc-f-pants-c" accent="pink" />
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <Toggle label="LEFT LEG UP" on={!!build.fLegLeftUp} onClick={() => update({ fLegLeftUp: !build.fLegLeftUp })} testid="cc-f-leg-l" accent="pink" />
              <Toggle label="RIGHT LEG UP" on={!!build.fLegRightUp} onClick={() => update({ fLegRightUp: !build.fLegRightUp })} testid="cc-f-leg-r" accent="pink" />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          <Toggle label="SOCKS" on={build.fSocksOn !== false} onClick={() => update({ fSocksOn: !(build.fSocksOn !== false) })} testid="cc-f-socks" accent="pink" />
          <Toggle label="SHOES" on={build.fShoesOn !== false} onClick={() => update({ fShoesOn: !(build.fShoesOn !== false) })} testid="cc-f-shoes" accent="pink" />
        </div>
        {build.fSocksOn !== false && (
          <>
            <SubLabel>SOCKS COLOR</SubLabel>
            <Swatches value={build.fSocksHex} onPick={hex => update({ fSocksHex: hex })} testPrefix="cc-f-socks-c" accent="pink" />
          </>
        )}
        {build.fShoesOn !== false && (
          <>
            <SubLabel>SHOES COLOR</SubLabel>
            <Swatches value={build.fShoesHex} onPick={hex => update({ fShoesHex: hex })} testPrefix="cc-f-shoes-c" accent="pink" />
          </>
        )}
      </Section>
    </>
  );
}
