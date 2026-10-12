require("../src/core.js");
const fs=require("fs");
const R=require("../data/rules.json");
const src=process.argv[2]||"letrans";
const e=LEKR.createEngine(require(`../data/le_ko_${src}.json`),R);
const out={lines:[],texts:[],multi:[]};
for(const l of fs.readFileSync(__dirname+"/lines.txt","utf8").trim().split("\n")){const i=l.indexOf("#");const r=e.translateLine(l.slice(0,i),l.slice(i+1));out.lines.push([l,r?r.pre+"[값]"+r.post:null]);}
for(const t of fs.readFileSync(__dirname+"/texts.txt","utf8").trim().split("\n")) out.texts.push([t,e.lookupText(t)]);
for(const t of fs.readFileSync(__dirname+"/multi.txt","utf8").trim().split("\n")) out.multi.push([t,e.lookupText(t)]);
const ok=a=>a.filter(x=>x[1]).length;
console.log(`[${src}] 줄 ${ok(out.lines)}/${out.lines.length}  텍스트 ${ok(out.texts)}/${out.texts.length}  특수효과 ${ok(out.multi)}/${out.multi.length}`);
if(process.argv[3]==="v"){for(const k of ["lines","texts","multi"]){console.log("==",k);for(const [a,b] of out[k]) console.log((b?"  ":"✗ ")+a.padEnd(58)+" → "+(b||""));}}
