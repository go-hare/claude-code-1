function Jx(m){let l=djt+`
`,p=`
${m}`.indexOf(`
${l}`);if(p===-1)return m;let h=m.slice(p+l.length);if(p===0)return lw(h);return`${lw(m.slice(0,p-1))}

${h}`}