function ua(m,l){let p=Math.max(1e4,Qx*l*4+1),h=re(m,p),M=h.length<m.length,R=XI(h).split(`
`),C=[],_=Qx,v=0,E=M;for(let[j,O]of R.entries()){if(_===0){E=!0;break}let W=re(O,_*l*4),H=Lu(W,l,{hard:!0,trim:!1}).split(`
`);if(W.length<O.length||M&&j===R.length-1||H.length>_){C.push(H.slice(0,_).join("")),E=!0;break}C.push(O),v++,_-=H.length}if(!E&&v===R.length)return null;let F=C.join(`
`),U=Gt(m,`
`)+1;return{shown:F,hiddenLines:U-v,hiddenChars:m.length-F.length}}