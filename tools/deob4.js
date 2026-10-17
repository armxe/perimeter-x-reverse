const fs=require('fs'),parser=require('@babel/parser'),traverse=require('@babel/traverse').default,gen=require('@babel/generator').default,t=require('@babel/types');
const ast=parser.parse(fs.readFileSync(process.argv[2],'utf8'),{sourceType:'script',errorRecovery:true});
function xorDec(s){
  let b; try{ b=Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64'); }catch(e){return null;}
  if(!b.length) return null;
  const k=b[0]; const out=Buffer.alloc(b.length-1);
  for(let i=1;i<b.length;i++) out[i-1]=k^b[i];
  return out.toString('utf8');
}
// identify decoder function nodes
const decFns=new Set();
traverse(ast,{Function(p){
  const c=gen(p.node).code.replace(/\s+/g,' ');
  if(/atob\(/.test(c) && /charCodeAt\(0\)/.test(c) && /String\.fromCharCode\(/.test(c) && c.length<400) decFns.add(p.node);
}});
console.error('xor decoders:',decFns.size);
function resolveToFn(path,name,depth){
  if(depth>8)return null;
  const b=path.scope.getBinding(name); if(!b)return null;
  const n=b.path.node;
  if(n.type==='FunctionDeclaration')return n;
  if(n.type==='VariableDeclarator'&&n.init){
    if(/Function/.test(n.init.type))return n.init;
    if(n.init.type==='Identifier')return resolveToFn(b.path,n.init.name,depth+1);
  }
  return null;
}
let done=0,bad=0;const badS=[];
traverse(ast,{CallExpression(p){
  const cal=p.node.callee; if(cal.type!=='Identifier'||p.node.arguments.length!==1)return;
  const a=p.node.arguments[0]; if(a.type!=='StringLiteral')return;
  const fn=resolveToFn(p,cal.name,0); if(!fn||!decFns.has(fn))return;
  const s=xorDec(a.value);
  if(s==null||/[\uFFFD]/.test(s)){bad++;badS.push(a.value);return;}
  p.replaceWith(t.stringLiteral(s));done++;
}});
console.error('inlined',done,'bad',bad,badS.slice(0,8));
fs.writeFileSync(process.argv[3],gen(ast,{comments:true}).code);
