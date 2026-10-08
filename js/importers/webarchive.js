// Safari web archives (.webarchive) are binary property lists. The page's HTML is in
// WebMainResource → WebResourceData. This reads just enough of the bplist format to get it.

export function webarchiveToHtml(buffer) {
  const u8 = new Uint8Array(buffer);
  const head = new TextDecoder("ascii").decode(u8.subarray(0, 8));
  if (head !== "bplist00") throw new Error("That web archive couldn't be read.");
  const dv = new DataView(buffer);
  const t = u8.length - 32;
  const offSize = u8[t + 6], refSize = u8[t + 7];
  const num = Number(dv.getBigUint64(t + 8));
  const top = Number(dv.getBigUint64(t + 16));
  const tableAt = Number(dv.getBigUint64(t + 24));
  const uint = (pos, size) => { let v = 0; for (let k = 0; k < size; k++) v = v * 256 + u8[pos + k]; return v; };
  const offset = (ref) => uint(tableAt + ref * offSize, offSize);

  const read = (ref, depth = 0) => {
    if (depth > 40 || ref >= num) throw new Error("That web archive is damaged.");
    let p = offset(ref);
    const marker = u8[p];
    const hi = marker >> 4;
    let lo = marker & 15;
    p++;
    const len = () => {
      if (lo !== 15) return lo;
      const size = 1 << (u8[p] & 15);
      const v = uint(p + 1, size);
      p += 1 + size;
      return v;
    };
    switch (hi) {
      case 0: return lo === 8 ? false : lo === 9 ? true : null;
      case 1: return uint(p, 1 << lo);
      case 4: { const n = len(); return u8.subarray(p, p + n); }
      case 5: { const n = len(); return new TextDecoder("latin1").decode(u8.subarray(p, p + n)); }
      case 6: {
        const n = len();
        let s = "";
        for (let k = 0; k < n; k++) s += String.fromCharCode((u8[p + 2 * k] << 8) | u8[p + 2 * k + 1]);
        return s;
      }
      case 10: { const n = len(); const out = []; for (let k = 0; k < n; k++) out.push(read(uint(p + k * refSize, refSize), depth + 1)); return out; }
      case 13: {
        const n = len();
        const out = {};
        for (let k = 0; k < n; k++) {
          const key = read(uint(p + k * refSize, refSize), depth + 1);
          out[key] = read(uint(p + (n + k) * refSize, refSize), depth + 1);
        }
        return out;
      }
      default: return null; // dates, reals, uids and sets aren't needed here
    }
  };

  const root = read(top);
  const main = root && root.WebMainResource;
  if (!main || !main.WebResourceData) throw new Error("That web archive doesn't contain a page.");
  const enc = (main.WebResourceTextEncodingName || "utf-8").toLowerCase();
  try {
    return new TextDecoder(enc).decode(main.WebResourceData);
  } catch {
    return new TextDecoder("utf-8").decode(main.WebResourceData);
  }
}
