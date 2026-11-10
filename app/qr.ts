// A small QR code maker, so a tablet can join a race by pointing its camera at
// the host's screen. Byte mode, error-correction level L, versions 1 to 5
// (up to 106 characters), which is plenty for an invite link.

// [total data bytes, error-correction bytes] for versions 1..5 at level L (one block each)
const CAP: [number, number][] = [[19, 7], [34, 10], [55, 15], [80, 20], [108, 26]];

// ----- Reed-Solomon over GF(256), polynomial 0x11D -----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data: number[], ecLen: number): number[] {
  // Generator polynomial with roots a^0 .. a^(ecLen-1)
  const gen: number[] = new Array(ecLen).fill(0);
  gen[ecLen - 1] = 1;
  let root = 1;
  for (let i = 0; i < ecLen; i++) {
    for (let j = 0; j < ecLen; j++) {
      gen[j] = mul(gen[j], root);
      if (j + 1 < ecLen) gen[j] ^= gen[j + 1];
    }
    root = mul(root, 2);
  }
  const rem: number[] = new Array(ecLen).fill(0);
  for (const b of data) {
    const f = b ^ (rem.shift() as number);
    rem.push(0);
    for (let j = 0; j < ecLen; j++) rem[j] ^= mul(gen[j], f);
  }
  return rem;
}

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of unescape(encodeURIComponent(text))) out.push(ch.charCodeAt(0));
  return out;
}

/** Returns the QR code as rows of dark (true) and light (false) squares, or null if the text is too long. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = utf8(text);
  let version = 0;
  for (let v = 1; v <= CAP.length; v++) {
    if (bytes.length <= CAP[v - 1][0] - 2) {
      version = v;
      break;
    }
  }
  if (!version) return null;
  const [dataLen, ecLen] = CAP[version - 1];
  const size = 17 + version * 4;

  // ----- Data bits: mode, length, bytes, terminator, padding -----
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(4, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < dataLen * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const all = [...data, ...rsRemainder(data, ecLen)];

  // ----- Fixed patterns -----
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    m[y][x] = dark;
    fixed[y][x] = true;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 0; i < size; i++) {
    if (!fixed[6][i]) set(i, 6, i % 2 === 0);
    if (!fixed[i][6]) set(6, i, i % 2 === 0);
  }
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const d = (1 << 3) | mask; // level L is 01
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserves the format squares before the data goes in

  // ----- Data squares, zig-zagging up and down from the bottom right -----
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x]) continue;
        if (k < all.length * 8) m[y][x] = ((all[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
  }

  // ----- Pick the mask that gives the easiest pattern to scan -----
  const maskAt = (mask: number, x: number, y: number): boolean => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && maskAt(mask, x, y)) m[y][x] = !m[y][x];
  };
  const penalty = (): number => {
    let p = 0;
    const line = (get: (i: number, j: number) => boolean) => {
      for (let i = 0; i < size; i++) {
        let run = 1;
        let hist = 0;
        for (let j = 0; j < size; j++) {
          const v = get(i, j);
          if (j > 0 && v === get(i, j - 1)) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else run = 1;
          // Finder-like pattern 1:1:3:1:1 with 4 light squares on one side
          hist = ((hist << 1) | (v ? 1 : 0)) & 0x7ff;
          if (j >= 10 && (hist === 0x5d0 || hist === 0x05d)) p += 40;
        }
      }
    };
    line((i, j) => m[i][j]);
    line((i, j) => m[j][i]);
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
    }
    p += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
    return p;
  };
  let best = 0;
  let bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const p = penalty();
    if (p < bestP) {
      bestP = p;
      best = mask;
    }
    applyMask(mask); // undo
  }
  applyMask(best);
  drawFormat(best);
  return m;
}

/** The dark squares as one SVG path (each square is 1 unit, with a quiet border of `margin`). */
export function qrPath(m: boolean[][], margin = 3): { d: string; size: number } {
  let d = '';
  for (let y = 0; y < m.length; y++) {
    let x = 0;
    while (x < m.length) {
      if (!m[y][x]) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < m.length && m[y][x + w]) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
      x += w;
    }
  }
  return { d, size: m.length + margin * 2 };
}
