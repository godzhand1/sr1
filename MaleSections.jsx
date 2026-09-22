// MALE creator sections — granular layered toggles (Phase A modular).
import { SKIN_TONES, BODY_TYPES, MALE_STYLE_PRESETS } from './characterBuilder.js';
import { SR_CLOTHING } from '../brawl3d/srClothing.js';
import { Section, Toggle, Swatches, ModeRow, SubLabel } from './CreatorControls.jsx';

// Dropdown for picking one of the SR vanilla OBJ ids for a clothing
// slot.  Renders a native <select> for compactness — categories have
// 5-30 options each so chips would push the panel off-screen.
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

const ETHNICITIES = [
  { id: 'white',   name: 'White',   skinDefault: 'white_pale' },
  { id: 'spanish', name: 'Spanish', skinDefault: 'spanish_light' },
  { id: 'asian',   name: 'Asian',   skinDefault: 'asian_light' },
  { id: 'black',   name: 'Black',   skinDefault: 'black_light' },
];

export function MaleLookSections({ build, update }) {
  return (
    <>
      <Section title="Ethnicity">
        <ModeRow
          options={ETHNICITIES}
          value={build.ethnicity}
          onChange={(id) => update({ ethnicity: id, skinId: ETHNICITIES.find(e => e.id === id).skinDefault })}
          testPrefix="cc-eth"
        />
      </Section>

      <Section title="Skin Tone">
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
          {SKIN_TONES.map(s => (
            <button
              key={s.id}
              onClick={() => update({ skinId: s.id })}
              title={s.name}
              className={`aspect-square rounded border-2 ${build.skinId === s.id ? 'border-yellow-400' : 'border-zinc-700'}`}
              style={{ background: s.hex }}
              data-testid={`cc-skin-${s.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="Body Type">
        <ModeRow options={BODY_TYPES} value={build.bodyType || 'avg'} onChange={(id) => update({ bodyType: id })} testPrefix="cc-body" />
      </Section>

      <Section title="Hair Color">
        <Swatches value={build.mHairHex} onPick={hex => update({ mHairHex: hex })} testPrefix="cc-m-hair" />
        <div className="mt-2">
          <Toggle label="HAIRY CHEST" on={!!build.mHairy} onClick={() => update({ mHairy: !build.mHairy })} testid="cc-m-hairy" />
        </div>
      </Section>

      <Section title="SR Vanilla Head Assets">
        <SrSlot label="HAIR"         slot="hair"       value={build.srHair}       onChange={id => update({ srHair: id })}       testid="cc-m-sr-hair"   />
        <SrSlot label="FACIAL HAIR"  slot="facialHair" value={build.srFacialHair} onChange={id => update({ srFacialHair: id })} testid="cc-m-sr-fhair"  />
        <SrSlot label="HAT"          slot="hat"        value={build.srHat}        onChange={id => update({ srHat: id })}        testid="cc-m-sr-hat"    />
        <SrSlot label="GLASSES"      slot="glasses"    value={build.srGlasses}    onChange={id => update({ srGlasses: id })}    testid="cc-m-sr-glasses"/>
      </Section>
    </>
  );
}

export function MaleClothesSections({ build, update }) {
  const sag = build.mSag || 'below';
  return (
    <>
      <Section title="90s Style Presets">
        <div className="grid grid-cols-3 gap-1.5">
          {MALE_STYLE_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => update(p.patch)}
              className="px-2 py-2 text-[10px] font-bold rounded border border-zinc-600 bg-zinc-900 text-white/80 hover:border-yellow-400"
              data-testid={`cc-m-preset-${p.id}`}
            >{p.name}</button>
          ))}
        </div>
      </Section>

      <Section title="SR Vanilla Wardrobe">
        <SrSlot label="PANTS"   slot="pants"  value={build.srPants}  onChange={id => update({ srPants:  id })} testid="cc-m-sr-pants"  />
        <SrSlot label="SHIRT"   slot="shirt"  value={build.srShirt}  onChange={id => update({ srShirt:  id })} testid="cc-m-sr-shirt"  />
        <SrSlot label="JACKET"  slot="jacket" value={build.srJacket} onChange={id => update({ srJacket: id })} testid="cc-m-sr-jacket" />
        <SrSlot label="SHOES"   slot="shoes"  value={build.srShoes}  onChange={id => update({ srShoes:  id })} testid="cc-m-sr-shoes"  />
      </Section>

      <Section title="Head">
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle label="BANDANA" on={build.mBandanaOn !== false} onClick={() => update({ mBandanaOn: !(build.mBandanaOn !== false) })} testid="cc-m-bandana" />
          <Toggle label="FACE MASK" on={!!build.mMaskOn} onClick={() => update({ mMaskOn: !build.mMaskOn })} testid="cc-m-mask" />
        </div>
        {build.mBandanaOn !== false && (
          <>
            <SubLabel>BANDANA COLOR</SubLabel>
            <Swatches value={build.mBandanaHex} onPick={hex => update({ mBandanaHex: hex })} testPrefix="cc-m-bandana-c" />
          </>
        )}
        {!!build.mMaskOn && (
          <>
            <SubLabel>MASK COLOR</SubLabel>
            <Swatches value={build.mMaskHex} onPick={hex => update({ mMaskHex: hex })} testPrefix="cc-m-mask-c" />
          </>
        )}
        <SubLabel>CAP</SubLabel>
        <ModeRow
          options={[{ id: 'off', name: 'None' }, { id: 'straight', name: 'Straight' }, { id: 'back', name: 'Backwards' }, { id: 'side', name: 'Sideways' }]}
          value={build.mCapMode || 'off'}
          onChange={(id) => update({ mCapMode: id })}
          testPrefix="cc-m-cap"
        />
        {build.mCapMode && build.mCapMode !== 'off' && (
          <Swatches value={build.mCapHex} onPick={hex => update({ mCapHex: hex })} testPrefix="cc-m-cap-c" />
        )}
      </Section>

      <Section title="Upper Body (3 layers)">
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle label="GOLD CHAIN" on={build.mChainOn !== false} onClick={() => update({ mChainOn: !(build.mChainOn !== false) })} testid="cc-m-chain" />
          <Toggle label="UNDERSHIRT" on={build.mUnderOn !== false} onClick={() => update({ mUnderOn: !(build.mUnderOn !== false) })} testid="cc-m-under" />
          <Toggle label="SHIRT" on={build.mShirtOn !== false} onClick={() => update({ mShirtOn: !(build.mShirtOn !== false) })} testid="cc-m-shirt" />
          <Toggle label="JACKET" on={build.mJacketOn !== false} onClick={() => update({ mJacketOn: !(build.mJacketOn !== false) })} testid="cc-m-jacket" />
        </div>
        {build.mUnderOn !== false && (
          <>
            <SubLabel>UNDERSHIRT COLOR</SubLabel>
            <Swatches value={build.mUnderHex} onPick={hex => update({ mUnderHex: hex })} testPrefix="cc-m-under-c" />
          </>
        )}
        {build.mShirtOn !== false && (
          <>
            <SubLabel>SHIRT COLOR</SubLabel>
            <Swatches value={build.mShirtHex} onPick={hex => update({ mShirtHex: hex })} testPrefix="cc-m-shirt-c" />
          </>
        )}
        {build.mJacketOn !== false && (
          <>
            <SubLabel>JACKET COLOR</SubLabel>
            <Swatches value={build.mJacketHex} onPick={hex => update({ mJacketHex: hex })} testPrefix="cc-m-jacket-c" />
            <div className="mt-2">
              <Toggle label="HOOD UP" on={!!build.mHoodUp} onClick={() => update({ mHoodUp: !build.mHoodUp })} testid="cc-m-hood" />
            </div>
          </>
        )}
      </Section>

      <Section title="Lower Body">
        <SubLabel>PANTS STYLE</SubLabel>
        <ModeRow
          options={[{ id: 'below', name: 'Saggin\u2019' }, { id: 'above', name: 'Worn Up' }, { id: 'none', name: 'Boxers Only' }]}
          value={sag}
          onChange={(id) => update({ mSag: id })}
          testPrefix="cc-m-sag"
        />
        {sag !== 'above' && (
          <>
            <SubLabel>BOXERS COLOR</SubLabel>
            <Swatches value={build.mBoxersHex} onPick={hex => update({ mBoxersHex: hex })} testPrefix="cc-m-boxers-c" />
          </>
        )}
        {sag !== 'none' && (
          <>
            <SubLabel>PANTS COLOR</SubLabel>
            <Swatches value={build.mPantsHex} onPick={hex => update({ mPantsHex: hex })} testPrefix="cc-m-pants-c" />
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <Toggle label="LEFT LEG UP" on={!!build.mLegLeftUp} onClick={() => update({ mLegLeftUp: !build.mLegLeftUp })} testid="cc-m-leg-l" />
              <Toggle label="RIGHT LEG UP" on={!!build.mLegRightUp} onClick={() => update({ mLegRightUp: !build.mLegRightUp })} testid="cc-m-leg-r" />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          <Toggle label="SOCKS" on={build.mSocksOn !== false} onClick={() => update({ mSocksOn: !(build.mSocksOn !== false) })} testid="cc-m-socks" />
          <Toggle label="SHOES" on={build.mShoesOn !== false} onClick={() => update({ mShoesOn: !(build.mShoesOn !== false) })} testid="cc-m-shoes" />
        </div>
        {build.mSocksOn !== false && (
          <>
            <SubLabel>SOCKS COLOR</SubLabel>
            <Swatches value={build.mSocksHex} onPick={hex => update({ mSocksHex: hex })} testPrefix="cc-m-socks-c" />
          </>
        )}
        {build.mShoesOn !== false && (
          <>
            <SubLabel>SHOES COLOR</SubLabel>
            <Swatches value={build.mShoesHex} onPick={hex => update({ mShoesHex: hex })} testPrefix="cc-m-shoes-c" />
          </>
        )}
      </Section>
    </>
  );
}
