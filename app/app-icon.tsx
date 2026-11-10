// The home-screen icon, drawn with plain shapes (no image files, no fonts).
export function AppIcon({ size }: { size: number }) {
  const u = size / 64;
  const wheel = (left: number) => (
    <div style={{ position: 'absolute', left: left * u, top: 40 * u, width: 15 * u, height: 15 * u, borderRadius: 99 * u, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 6 * u, height: 6 * u, borderRadius: 99 * u, background: '#e2e8f0' }} />
    </div>
  );
  return (
    <div style={{ width: size, height: size, display: 'flex', position: 'relative', background: 'linear-gradient(180deg, #2f9bf0, #7dd3fc)' }}>
      <div style={{ position: 'absolute', left: 6 * u, top: 6 * u, width: 15 * u, height: 15 * u, borderRadius: 99 * u, background: '#fde047' }} />
      <div style={{ position: 'absolute', left: -8 * u, top: 42 * u, width: 80 * u, height: 40 * u, borderRadius: 40 * u, background: '#4ade80' }} />
      {/* spoiler */}
      <div style={{ position: 'absolute', left: 15 * u, top: 26 * u, width: 6 * u, height: 10 * u, background: '#0f172a' }} />
      <div style={{ position: 'absolute', left: 11 * u, top: 22 * u, width: 15 * u, height: 6 * u, borderRadius: 2 * u, background: '#e11d48', border: `${2 * u}px solid #0f172a` }} />
      {/* body */}
      <div style={{ position: 'absolute', left: 9 * u, top: 33 * u, width: 46 * u, height: 13 * u, borderRadius: 7 * u, background: 'linear-gradient(180deg, #fb7185, #e11d48)', border: `${2.5 * u}px solid #0f172a` }} />
      {/* helmet and visor */}
      <div style={{ position: 'absolute', left: 24 * u, top: 18 * u, width: 20 * u, height: 20 * u, borderRadius: 99 * u, background: '#fde047', border: `${2.5 * u}px solid #0f172a` }} />
      <div style={{ position: 'absolute', left: 32 * u, top: 25 * u, width: 12 * u, height: 5.5 * u, borderRadius: 3 * u, background: '#0f172a' }} />
      {wheel(11)}
      {wheel(38)}
    </div>
  );
}
