// ---- function Qyr( ----
function Qyr(e){let t=yie(e);for(let r=0;r<e.length;r++)if(e[r]==="--"&&!t.has(r))return r;return-1}

// ---- function r2o( ----
function r2o(e,t,r){let n=yie(e),o;for(let i=0;i<e.length;i++){if(n.has(i))continue;let s=e[i];if(s==="--")break;if(s===t||r!==void 0&&s===r){if(e[i+1]!==void 0)o=e[i+1],i++;continue}if(s.startsWith(`${t}=`)){o=s.slice(t.length+1);continue}if(r!==void 0){let{peeled:a,rest:l}=IUe(s);if(l.length>2&&l.slice(0,2)===r){o=l.slice(2);continue}if(a.length>0&&l===r&&e[i+1]!==void 0)o=e[i+1],i++}}return o}

// ---- function WLp( ----
function WLp(e){let t=yie(e),r;for(let n=0;n<e.length;n++){if(t.has(n))continue;let o=e[n];if(o==="--")break;if(o.startsWith("--resume=")){r=o.slice(9)||void 0;continue}let{rest:i}=IUe(o);if(/^-r./.test(i)){r=i.slice(2);continue}if(o==="--resume"||i==="-r"){let s=e[n+1];if(s!==void 0&&!tke(s))r=s,n++;else r=void 0}}return r}

// ---- function t6_( ----
function t6_(e,t){let r=yie(e),n;for(let o=0;o<e.length;o++){if(r.has(o))continue;let i=e[o];if(tke(i)){let{rest:s}=IUe(i);if((i==="--resume"||s==="-r")&&e[o+1]!==void 0&&!tke(e[o+1]))o++;continue}if(i.length>0&&i!==t)n=i}return n}

// ---- function yie( ----
function yie(e){let t=new Set;for(let r=0;r<e.length;r++){if(t.has(r))continue;let n=e[r];if(n==="--")break;let{rest:o}=IUe(n);if(n==="--resume"||o==="-r")continue;if((n==="--remote-control"||n==="--rc")&&e[r+1]!==void 0&&!(e[r+1].length>1&&e[r+1].startsWith("-"))){t.add(r+1);continue}if(!o.includes("=")&&Hne.has(o)&&e[r+1]!==void 0){if(t.add(r+1),zRt.has(o)){let i=r+2;while(e[i]!==void 0&&!(e[i].length>1&&e[i].startsWith("-")))t.add(i),i++}}}return t}

// ---- function IUe( ----
function IUe(e){let t=[],r=e;while(/^-[a-zA-Z]./.test(r)&&jfo.has(r.slice(0,2)))t.push(r.slice(0,2)),r=`-${r.slice(2)}`;return{peeled:t,rest:r}}

// ---- function n2o( ----
function n2o(e){let t=yie(e),r=[];for(let n=0;n<e.length;n++){let o=e[n];if(t.has(n)){r.push(o);continue}if(o==="--"){for(let a=n;a<e.length;a++)r.push(e[a]);break}if(o==="--fork-session"||o==="--continue"||o.startsWith("--resume=")||o.startsWith("--session-id="))continue;let{peeled:i,rest:s}=IUe(o);if(i.length>0||s==="-c"||s.startsWith("-r")){let a=i.filter((d)=>d!=="-c").map((d)=>d[1]),l=s==="-c"||/^-r./.test(s),c=s==="-r",u=l||c?"":s.slice(1);if(a.length>0||u)r.push(`-${a.join("")}${u}`);if(c&&e[n+1]!==void 0&&!tke(e[n+1]))n++;continue}if(o==="--session-id"){if(e[n+1]!==void 0)n++;continue}if(o==="--resume"){if(e[n+1]!==void 0&&!tke(e[n+1]))n++;continue}r.push(o)}return r}

// ---- function e6_( ----
function e6_(e){let t=Qyr(e),r=t>=0?e.slice(0,t):e,n=yie(r),o=r.filter((s,a)=>!n.has(a));if(nPs(o))return rPs(r);if(o.some((s)=>{let{peeled:a,rest:l}=IUe(s);return s==="--print"||s.startsWith("--print=")||a.includes("-p")||l==="-p"}))return"--bg and --print conflict: --print never starts the interactive session that `claude agents` attaches to, so the job would be unattachable. The prompt is the positional \u2014 drop --print: `claude --bg '<task>'`.";let i=r2o(r,"--permission-mode");if((i==="bypassPermissions"||o.includes("--dangerously-skip-permissions")||o.includes("--allow-dangerously-skip-permissions"))&&!ZV()&&!At().bypassPermissionsModeAccepted)return"--bg with bypassPermissions requires accepting the disclaimer first. Run `claude --dangerously-skip-permissions` once interactively.";if(i==="auto"&&!fyi())return"--bg with auto mode requires opting in first. Run `claude --permission-mode auto` once interactively.";return null}

// ---- function ULp( ----
function ULp(e,t){let r=Qyr(e);if(r>=0){let i=e.slice(r+1).join(" ");return[...e.slice(0,r),"--",i?`${i}
${t}`:t]}let n=yie(e),o=-1;for(let i=0;i<e.length;i++){if(n.has(i))continue;let s=e[i];if(tke(s)){if(s.includes("="))continue;let a=e[i+1];if(a===void 0)continue;let{rest:l}=IUe(s);if(s==="--resume"||l==="-r"){if(!tke(a))i++;continue}if(l.length>2&&(/^-r./.test(l)||Hne.has(l.slice(0,2))))continue;if($Yr.has(s)&&s!=="--remote-control"&&s!=="--rc"||jfo.has(l))continue;if(!n.has(i+1)&&!tke(a))i++;continue}o=i}if(o>=0){let i=[...e];return i[o]=`${e[o]}
${t}`,i}return[...e,"--",t]}

// ---- function lsa( ----
function lsa(e){let t=Qyr(e),r=t>=0?e.slice(0,t):e,n=yie(r),o=r.filter((i,s)=>n.has(s)||!$q_.includes(i));return t>=0?[...o,...e.slice(t)]:o}

// ---- function xmt( ----
function xmt(e,t,r){let n=(o,i)=>gt.dim("  "+o.padEnd(26)+i);return[`backgrounded \xB7 ${gt.cyan(e)}${r?` \xB7 ${r}`:""}${t?gt.dim(` ${t}`):""}`,n("claude agents","list sessions"),n(`claude attach ${e}`,"open in this terminal"),n(`claude logs ${e}`,"show recent output"),n(`claude stop ${e}`,"stop this session")].join(`
`)}

// ---- function nPs( ----
function nPs(e){return e.some((t)=>t==="--cloud"||t.startsWith("--cloud=")||t==="--remote"||t.startsWith("--remote="))}

// ---- function rPs( ----
function rPs(e){return"--bg and --cloud are different backends. Use `claude --cloud '<task>'` directly to start a cloud session."}

// ---- function FLp( ----
async function FLp(e=process.stdin){if(e.isTTY)return"";let t="",r=!1,n=(i)=>{if(r)return;if(t.length+i.length>ssa){t+=i.slice(0,ssa-t.length),r=!0;return}t+=i};try{e.setEncoding("utf8"),e.on("data",n)}catch(i){if(e.off("data",n),!$3t(i))throw i;return T(`readBgStdin: stdin unreadable: ${ue(i)}`,{level:"error"}),await Bb("tengu_bg_stdin_unreadable",{error_code:t7(i)??ke("none")}),process.stderr.write(`warning: stdin is unreadable (${Gt(i)}), proceeding without piped input
`),""}let o=await UIr(e,3000);if(e.off("data",n),o)return"";if(r)process.stderr.write(`warning: piped stdin exceeds ${ssa} bytes, truncated
`);return t.replace(/\r?\n$/,"")}

