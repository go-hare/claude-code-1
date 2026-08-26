import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

const i = buf.indexOf(Buffer.from('if(s&&p===""&&e.trim()!=="")'));
const j = buf.indexOf(Buffer.from("Esc again to clear"));
const k = buf.indexOf(Buffer.from("escape-again-to-clear"), 317900000);

function around(off, before, after) {
  return ascii(
    buf.subarray(Math.max(0, off - before), Math.min(buf.length, off + after)).toString("latin1"),
  );
}

const lines = [
  `i=${i} j=${j} k=${k}`,
  "\n==== s&&p empty ====\n",
  around(i, 2500, 2000),
  "\n==== yank / kill nearby (search mask in 317990000-318050000) ====\n",
];

const region = buf.subarray(317990000, 318080000).toString("latin1");
for (const n of ["mask", "yank", "kill", "p===", "s&&", "pushTo", "t_t("]) {
  let from = 0;
  let c = 0;
  lines.push(`\n-- ${n} --`);
  while (c < 6) {
    const x = region.indexOf(n, from);
    if (x < 0) break;
    lines.push(ascii(region.slice(Math.max(0, x - 60), x + 100)));
    from = x + 1;
    c++;
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-mask-input.txt",
  lines.join("\n"),
);
console.log("ok", i);
