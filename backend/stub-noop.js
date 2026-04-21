
const h = { get: (_,k) => typeof k==='symbol'?undefined:()=>h, apply:()=>h };
const p = new Proxy(()=>{},h);
module.exports = p;
