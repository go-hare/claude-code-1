import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const s = readFileSync(exe).toString("latin1");

const wanted = [
  ["sWt", "function sWt(e){return`"],
  ["DEe", "function DEe(e,t,r="],
  ["Zio", "function Zio(e){return`"],
  ["Kwm", "function Kwm(e){return`"],
  ["qEt", "function qEt(e){return`"],
  ["vWi", 'var vWi="'],
  ["qwm", "qwm=`address the main conversation as"],
  ["Jio", "function Jio(e,t){"],
  ["lRw", "function lRw(e){"],
  ["g5", "function g5(e){"],
  ["Xen", "function Xen(e){"],
  ["VEt", "function VEt(e){"],
  ["MZe", "function MZe(e){"],
];
const out = [];
for (const [name, needle] of wanted) {
  const i = s.indexOf(needle);
  if (i < 0) {
    out.push(`### ${name}: NOT FOUND (needle=${JSON.stringify(needle)})`);
    continue;
  }
  out.push(`### ${name} @${i}\n${s.slice(i, i + 620)}\n`);
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-vfy-selfsend-utf8.txt",
  out.join("\n"),
);

// The minifier emits the em dash as the 6-char escape \u2014 in source, so
// compare against that spelling rather than the decoded character.
const esc = (t) => t.replaceAll("\u2014", "\\u2014");

const localStrings = {
  "ownSession.ts sWt": `Not sent \u2014 '\${to}' is this session's own name.`,
  "ownSession.ts DEe subagent": `'\${to}' is this process's own main session\${hint} \u2014 from inside it, \${ADDRESS_MAIN} instead.`,
  "ownSession.ts DEe hint": ` ("\${registeredName}" is the name OTHER sessions use for it)`,
  "ownSession.ts DEe named": `'\${to}' is this session itself \u2014 "\${registeredName}" is the name other sessions use to message YOU; there is no one else by that name to send to.`,
  "ownSession.ts DEe bare": `'\${to}' is this session itself \u2014 there is no one else at that address to send to.`,
  "ownSession.ts vWi": `target is this session itself \u2014 there is no one else to send to`,
  "ownSession.ts ADDRESS_MAIN": `address the main conversation as "\${MAIN_RECIPIENT_NAME}"`,
};
// Rewrite the local interpolations into the official minified parameter names.
const rename = (t) =>
  t
    .replaceAll("${to}", "${e}")
    .replaceAll("${hint}", "${i}")
    .replaceAll("${ADDRESS_MAIN}", "${r}")
    .replaceAll("${registeredName}", "${o}")
    .replaceAll("${MAIN_RECIPIENT_NAME}", "${dL}");

for (const [label, str] of Object.entries(localStrings)) {
  const probe = esc(rename(str));
  console.log(
    (s.includes(probe) ? "MATCH  " : "NO-MATCH") + "  " + label + "  ::  " + probe,
  );
}
