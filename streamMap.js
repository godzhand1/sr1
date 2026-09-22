// Legacy stream table kept for the Shift+S SoundTester. Runtime playback
// goes through brawl3d/audio/soundRegistry.js (same stream numbers).
export const STREAM_MAP = {
  pistol:       { stream: 44, reload: 31, volume: 0.65 },
  smg:          { stream: 101, reload: 50, volume: 0.55 },
  shotgun:      { stream:  53, reload: 60, volume: 0.80 },
  ak47:         { stream: 9, reload: 11, volume: 0.70 },
  ak47_single:  { stream: 9, reload: 11, volume: 0.70 },
  ak47_burst:   { stream: 9, reload: 11, volume: 0.70 },
  ak47_auto:    { stream: 111, reload: 11, volume: 0.70 },
  rifle:        { stream:  8, reload: 48, volume: 0.70 },
  tec9:         { stream: 39, reload: 106, volume: 0.55 },
  rpg:          { stream:  63, reload: 173, volume: 0.95 },
  pipebomb:     { stream: 44, reload: null, volume: 0.85 },
  bat:          { stream: 71, reload: null, volume: 0.75 },
  fist:         { stream: 72, reload: null, volume: 0.60 },
  empty:        { stream:108, reload: null, volume: 0.50 },
  bat_finisher: { stream: 95, reload: null, volume: 1.00 },
};
