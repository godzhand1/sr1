// Small shared building blocks for the character creator sections.
import { FEMALE_COLORS } from './characterBuilder.js';

const ACCENT = {
  yellow: 'border-yellow-400 bg-yellow-500/10 text-yellow-200',
  pink: 'border-pink-400 bg-pink-500/10 text-pink-200',
};
const ACCENT_BORDER = { yellow: 'border-yellow-400', pink: 'border-pink-400' };

export function Section({ title, children }) {
  return (
    <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-2">{title}</div>
      {children}
    </div>
  );
}

export function Toggle({ label, on, onClick, testid, accent = 'yellow' }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1.5 text-[10px] font-bold rounded border ${on ? ACCENT[accent] : 'border-zinc-700 bg-zinc-900 text-white/50'}`}
      data-testid={testid}
    >{label}: {on ? 'ON' : 'OFF'}</button>
  );
}

export function Swatches({ value, onPick, testPrefix, accent = 'yellow' }) {
  return (
    <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 mt-1.5">
      {FEMALE_COLORS.map(c => (
        <button
          key={c.id}
          onClick={() => onPick(c.hex)}
          title={c.id}
          className={`aspect-square rounded border-2 ${value === c.hex ? ACCENT_BORDER[accent] : 'border-zinc-700'}`}
          style={{ background: c.hex }}
          data-testid={`${testPrefix}-${c.id}`}
        />
      ))}
    </div>
  );
}

export function ModeRow({ options, value, onChange, testPrefix, accent = 'yellow' }) {
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 py-1.5 text-[10px] font-bold rounded border ${value === o.id ? ACCENT[accent] : 'border-zinc-700 bg-zinc-900 text-white/60'}`}
          data-testid={`${testPrefix}-${o.id}`}
        >{o.name}</button>
      ))}
    </div>
  );
}

export function SubLabel({ children }) {
  return <div className="text-[9px] text-white/50 font-bold tracking-widest mt-2">{children}</div>;
}
