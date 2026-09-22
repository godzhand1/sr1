// Team Gangsta Brawl — Perf HUD.
//
// Live overlay showing FPS, draw calls, triangles rendered, memory,
// and the current render backend. Position: bottom-right. Toggle via
// `window.__brawl3dPerf = true` (default off in production).

import React, { useEffect, useState } from 'react';

export function PerfHud({ renderer, engine }) {
  const [stats, setStats] = useState({
    fps: 60, frameMs: 0, worstMs: 0, scale: 1, lights: 0,
    triangles: 0, drawCalls: 0, points: 0, lines: 0,
    geoms: 0, tex: 0, programs: 0,
    backend: 'webgl2', quality: 'balanced',
    props: 0, botCount: 0, pickups: 0,
  });

  useEffect(() => {
    if (!renderer) return;
    const t = setInterval(() => {
      // Real rAF-to-rAF timing comes from the game loop (Brawl3DGame
      // publishes window.__brawl3dPerfStats); an interval can't see stalls.
      const p = (typeof window !== 'undefined' && window.__brawl3dPerfStats) || null;
      const avg = p && p.frameMs ? p.frameMs : 0;
      const fps = avg ? Math.round(1000 / avg) : 0;

      const info = renderer.info || {};
      const render = info.render || {};
      const memory = info.memory || {};
      setStats({
        fps, frameMs: Math.round(avg * 10) / 10,
        worstMs: p ? Math.round(p.worst * 10) / 10 : 0,
        scale: p ? Math.round(p.scale * 100) : 100,
        lights: p ? p.lights : 0,
        programs: (info.programs && info.programs.length) | 0,
        triangles: render.triangles | 0,
        drawCalls: render.calls | 0,
        points: render.points | 0,
        lines: render.lines | 0,
        geoms: memory.geometries | 0,
        tex: memory.textures | 0,
        backend: (typeof window !== 'undefined' && window.__brawl3dBackend) || 'webgl2',
        quality: (typeof window !== 'undefined' && window.__brawl3dQuality) || 'quality',
        props: engine?.pickups?.length || 0,
        botCount: engine?.bots?.size || 0,
        pickups: engine?.pickups?.filter(p => p.available).length || 0,
      });
    }, 250);
    return () => clearInterval(t);
  }, [renderer, engine]);

  // Color the FPS number red if we're below 30, amber below 55.
  const fpsColor = stats.fps < 30 ? '#f43f5e' : stats.fps < 55 ? '#facc15' : '#34d399';

  return (
    <div
      className="absolute bottom-3 right-3 z-[200] font-mono text-[10px] leading-[13px] px-2 py-1.5 bg-black/70 border border-white/15 rounded backdrop-blur-sm select-none pointer-events-none"
      data-testid="brawl3d-perf-hud"
      style={{ minWidth: 160, color: '#e2e8f0' }}
    >
      <div style={{ color: fpsColor }} data-testid="brawl3d-perf-fps">
        <span className="font-bold">{stats.fps} FPS</span>
        <span className="text-white/50"> · {stats.frameMs}ms · worst {stats.worstMs}ms</span>
      </div>
      <div className="text-white/60">
        res <span className="text-white">{stats.scale}%</span> · lights <span className="text-white">{stats.lights}</span> · programs <span className="text-white">{stats.programs}</span>
      </div>
      <div className="text-white/70">
        <span className="text-cyan-300">{stats.backend}</span>
        <span className="text-white/40"> · </span>
        <span className="text-fuchsia-300">{stats.quality}</span>
      </div>
      <div className="text-white/60">
        tris <span className="text-white">{stats.triangles.toLocaleString()}</span>
      </div>
      <div className="text-white/60">
        draws <span className="text-white">{stats.drawCalls}</span>
      </div>
      <div className="text-white/60">
        geo <span className="text-white">{stats.geoms}</span> · tex <span className="text-white">{stats.tex}</span>
      </div>
      <div className="text-white/60">
        bots <span className="text-white">{stats.botCount}</span> · pickups <span className="text-white">{stats.pickups}/{stats.props}</span>
      </div>
    </div>
  );
}
