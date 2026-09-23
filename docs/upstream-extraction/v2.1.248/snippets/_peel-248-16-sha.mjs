import { createHash } from 'crypto'

const bodies = {
  'q$n':
    'function q$n(e,t){let r={};for(let[u,p]of e)if(p)r[u]=p;let o=S(r);if(o==="{}"||!JE().notePersistedCacheBody(o))return Promise.resolve();if(D()&&t)return Promise.resolve().then(()=>t.write(hXe,o,{mode:438&~process.umask()})).then((u)=>{if(!u.ok)n(`persistPrStatusCache: ${u.error.code}`)}).catch((u)=>{n(`persistPrStatusCache: ${l(u)}`)});return Hn(gXe(),o).catch(()=>{})}',
  '#x':
    '#x(i){if(this.#i=i,this.#y=0,this.#t.prStatuses.size===0)this.#e.loadPrStatusCache(this.#n).then((d)=>{if(d.size)this.#E((m)=>m.size?new Map([...d,...m]):d)});if(this.load(),this.#s.push(w8(i,()=>void this.load(),fc),w8(i,this.#O,Ah),w8(i,()=>{this.#d},fc)),this.#d)this.#I()}',
  '#E':
    '#E(i){let d=this.#t.prStatuses;if(this.#p("prStatuses",i),this.#t.prStatuses!==d)this.#e.persistPrStatusCache(this.#t.prStatuses,this.#n)}',
}

for (const [name, body] of Object.entries(bodies)) {
  const sha = createHash('sha256').update(body).digest('hex').slice(0, 16)
  console.log(name, 'len=' + body.length, 'sha=' + sha)
}
