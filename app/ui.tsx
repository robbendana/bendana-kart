'use client';

// Menu building blocks that don't need to know anything about the game:
// the home backdrop, the logo, slide-up panels, the QR square and track thumbnails.

import { useEffect, useMemo, useRef } from 'react';
import { qrMatrix, qrPath } from './qr';

/** A bright, gently moving scene behind the home screen (CSS and SVG only). */
export function HomeBackdrop() {
  return (
    <div className="bk-home-bg pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="bk-sun absolute left-[8%] top-[7%] h-28 w-28 rounded-full sm:h-40 sm:w-40" />
      {[
        { top: '9%', w: 150, d: 46, delay: -8 },
        { top: '22%', w: 110, d: 62, delay: -30 },
        { top: '4%', w: 90, d: 78, delay: -52 },
        { top: '31%', w: 130, d: 55, delay: -18 },
      ].map((c, i) => (
        <div key={i} className="bk-cloud absolute" style={{ top: c.top, width: c.w, height: c.w * 0.36, animationDuration: `${c.d}s`, animationDelay: `${c.delay}s` }} />
      ))}
      <svg className="absolute inset-x-0 bottom-0 h-[62%] w-full" viewBox="0 0 1200 600" preserveAspectRatio="none">
        <path d="M0 250 C 150 150 300 170 430 240 C 560 310 700 170 860 200 C 1000 226 1100 170 1200 210 L1200 600 L0 600Z" fill="#86d977" />
        <path d="M0 330 C 200 240 380 300 560 340 C 760 384 900 260 1200 300 L1200 600 L0 600Z" fill="#5cc45a" />
        <path d="M0 430 C 260 340 520 420 760 440 C 940 455 1080 400 1200 420 L1200 600 L0 600Z" fill="#3fae4b" />
        {/* A road winding away into the hills */}
        <path d="M520 600 C 560 520 760 500 700 440 C 660 400 560 392 600 352 C 625 328 690 322 700 305" fill="none" stroke="#475569" strokeWidth="64" strokeLinecap="round" />
        <path d="M520 600 C 560 520 760 500 700 440 C 660 400 560 392 600 352 C 625 328 690 322 700 305" fill="none" stroke="#f8fafc" strokeWidth="5" strokeDasharray="20 26" className="bk-road-dash" />
        {[[120, 300, 1.1], [250, 270, 0.8], [940, 262, 1], [1080, 290, 1.25], [380, 372, 1.3], [1010, 410, 1.5], [190, 455, 1.6]].map(([x, y, s], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
            <rect x="-4" y="0" width="8" height="18" fill="#7c4a2d" />
            <circle cx="0" cy="-8" r="19" fill="#2f9e44" />
            <circle cx="-9" cy="-1" r="12" fill="#37b24d" />
            <circle cx="10" cy="-2" r="11" fill="#2b8a3e" />
          </g>
        ))}
      </svg>
      <div className="bk-checker absolute inset-x-0 bottom-0 h-3 opacity-80" />
    </div>
  );
}

/** The game's name, drawn big and chunky. */
export function Logo({ small }: { small?: boolean }) {
  return (
    <div className={`bk-logo select-none text-center leading-[0.86] ${small ? 'text-4xl sm:text-5xl' : 'text-6xl sm:text-7xl lg:text-8xl'}`}>
      <div className="bk-logo-top">BENDANA</div>
      <div className="bk-logo-bottom">
        <span className="bk-logo-flag" aria-hidden />
        KART
        <span className="bk-logo-flag" aria-hidden />
      </div>
    </div>
  );
}

/** A panel that slides up over the home screen or the lobby. */
export function Sheet({ title, onClose, children, footer, tone = 'from-indigo-600 via-violet-600 to-fuchsia-600' }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tone?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-30 flex flex-col bg-gradient-to-br ${tone}`} style={{ animation: 'bk-sheet 0.28s ease-out both' }} role="dialog" aria-label={title}>
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Back" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl font-black text-white ring-2 ring-white/40 transition active:scale-90">
          ←
        </button>
        <h2 className="min-w-0 flex-1 truncate text-2xl font-black text-white drop-shadow sm:text-3xl">{title}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 pt-2">{children}</div>
      </div>
      {footer && (
        <div className="border-t border-white/15 bg-black/25 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">{footer}</div>
        </div>
      )}
    </div>
  );
}

/** A scannable square for an invite link. Renders nothing if the link is too long. */
export function QrCode({ text, size }: { text: string; size: number }) {
  const qr = useMemo(() => {
    const m = text ? qrMatrix(text) : null;
    return m ? qrPath(m, 3) : null;
  }, [text]);
  if (!qr) return null;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="Scan to join this race" className="rounded-2xl shadow-xl">
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.d} fill="#0f172a" />
    </svg>
  );
}

export type ThumbLook = { grass: string; grass2: string; edge: string; road: string; curb: string; line: string };

/** A little map of a track, drawn from its real shape. `pts` is x,y pairs scaled 0..1. */
export function TrackThumb({ pts, look, width, height }: { pts: Float32Array; look: ThumbLook; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, look.grass2);
    bg.addColorStop(1, look.grass);
    g.fillStyle = bg;
    g.fillRect(0, 0, width, height);
    const pad = Math.max(8, width * 0.09);
    const X = (i: number) => pad + pts[i * 2] * (width - pad * 2);
    const Y = (i: number) => pad + pts[i * 2 + 1] * (height - pad * 2);
    const n = pts.length / 2;
    const path = () => {
      g.beginPath();
      g.moveTo(X(0), Y(0));
      for (let i = 1; i < n; i++) g.lineTo(X(i), Y(i));
      g.closePath();
    };
    const lw = Math.max(5, width * 0.062);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    path();
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = lw + 7;
    g.stroke();
    path();
    g.strokeStyle = look.curb;
    g.lineWidth = lw + 3.5;
    g.stroke();
    path();
    g.strokeStyle = look.road;
    g.lineWidth = lw;
    g.stroke();
    path();
    g.setLineDash([lw * 0.5, lw * 0.8]);
    g.strokeStyle = look.line;
    g.lineWidth = 1.2;
    g.stroke();
    g.setLineDash([]);
    // Start line: a small checkered flag spot
    const dx = X(1) - X(0);
    const dy = Y(1) - Y(0);
    const l = Math.hypot(dx, dy) || 1;
    g.save();
    g.translate(X(0), Y(0));
    g.rotate(Math.atan2(dy / l, dx / l));
    g.fillStyle = '#ffffff';
    g.fillRect(-2, -lw / 2, 4, lw);
    g.fillStyle = '#0f172a';
    g.fillRect(-2, -lw / 2, 2, lw / 2);
    g.fillRect(0, 0, 2, lw / 2);
    g.restore();
  }, [pts, look, width, height]);
  return <canvas ref={ref} style={{ width, height }} className="rounded-xl" aria-hidden />;
}
