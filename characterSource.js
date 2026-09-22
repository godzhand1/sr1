// Character source preference — user picks between the shipped
// customizable body ("default") and their Rig Lab-saved custom GLB
// ("custom"). Stored in localStorage so the choice survives reloads.
//
// The character loader (`characterMeshy.js`) reads this key to
// decide which URL to fetch. Flipping the source invalidates the
// shared template cache so the next spawn re-loads from the new
// source without a page refresh.

const KEY = 'sr_brawl3d_char_source';

/** 'default' | 'custom' — never returns anything else. */
export function getCharSource() {
  if (typeof localStorage === 'undefined') return 'default';
  const v = localStorage.getItem(KEY);
  return v === 'custom' ? 'custom' : 'default';
}

export function setCharSource(v) {
  if (typeof localStorage === 'undefined') return;
  const clean = v === 'custom' ? 'custom' : 'default';
  localStorage.setItem(KEY, clean);
}
