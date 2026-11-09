// Gzipped size of what the browser downloads.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let raw = 0, gz = 0;
for (const f of walk("dist").filter((f) => /\.(js|css|html)$/.test(f))) {
  const b = readFileSync(f);
  raw += b.length;
  gz += gzipSync(b, { level: 9 }).length;
  console.log(`${f}  ${(b.length / 1024).toFixed(1)} KB, gzip ${(gzipSync(b, { level: 9 }).length / 1024).toFixed(1)} KB`);
}
console.log(`total ${(raw / 1024).toFixed(1)} KB, gzip ${(gz / 1024).toFixed(1)} KB`);
