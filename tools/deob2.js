const fs=require('fs'),parser=require('@babel/parser'),traverse=require('@babel/traverse').default,gen=require('@babel/generator').default,t=require('@babel/types');
const src=fs.readFileSync(process.argv[2]||'main.min.js','utf8');
const ast=parser.parse(src,{sourceType:'script',errorRecovery:true});

function mkDecode(alpha){return function(e){const s=''+(e||'');const out=[];let o=0,i=0,a=-1;
 for(let c=0;c<s.length;c++){const f=alpha.indexOf(s[c]);if(f===-1)continue;if(a<0){a=f;continue;}
  a+=91*f;o|=a<<i;i+=((8191&a)>88)?13:14;do{out.push(255&o);o>>=8;i-=8;}while(i>7);a=-1;}
 if(a>-1)out.push(255&(o|(a<<i)));return Buffer.from(out).toString('utf8');};}

const decAlpha=new Map(); // function node -> alphabet (innermost enclosing fn)
traverse(ast,{StringLiteral(q){
 if(q.node.value.length!==91)return;
 if(q.parent.type!=='MemberExpression'||!q.parent.property||q.parent.property.name!=='indexOf')return;
 const f=q.getFunctionParent(); if(f) decAlpha.set(f.node,q.node.value);}});

function resolveFn(path,name){const b=path.scope.getBinding(name);if(!b)return null;const n=b.path.node;
 if(n.type==='FunctionDeclaration')return n;
 if(n.type==='VariableDeclarator'&&n.init&&/Function/.test(n.init.type))return n.init;return null;}
function resolveArr(path,name){const b=path.scope.getBinding(name);if(!b)return null;const n=b.path.node;
 if(n.type==='VariableDeclarator'&&n.init&&n.init.type==='ArrayExpression')return n.init.elements.map(e=>e&&e.type==='StringLiteral'?e.value:null);
 return null;}

// accessor detection
const accessors=new Map();
traverse(ast,{Function(p){
 if(decAlpha.has(p.node))return;
 if(p.node.params.length!==1||p.node.params[0].type!=='Identifier')return;
 const pname=p.node.params[0].name;
 let found=null,count=0;
 p.traverse({CallExpression(q){
   if(q.node.arguments.length!==1)return;
   const a=q.node.arguments[0];
   if(a.type!=='MemberExpression'||!a.computed||a.object.type!=='Identifier')return;
   if(a.property.type!=='Identifier'||a.property.name!==pname)return;
   let alpha=null;
   const cal=q.node.callee;
   if(/Function/.test(cal.type)&&decAlpha.has(cal)) alpha=decAlpha.get(cal);
   else if(cal.type==='Identifier'){const fn=resolveFn(q,cal.name);if(fn&&decAlpha.has(fn))alpha=decAlpha.get(fn);}
   if(!alpha)return;
   const arr=resolveArr(q,a.object.name); if(!arr)return;
   found={alpha,arr}; count++;
 }});
 if(found&&count===1){const d=mkDecode(found.alpha);
   accessors.set(p.node,{get:i=>{const v=found.arr[i];return v==null?null:d(v);},
     name:(p.node.id&&p.node.id.name)||'anon',line:p.node.loc.start.line});}
}});
console.error('decoders',decAlpha.size,'accessors',accessors.size);

let n=0,bad=0;
traverse(ast,{CallExpression(p){
 const cal=p.node.callee; if(cal.type!=='Identifier'||p.node.arguments.length!==1)return;
 const a=p.node.arguments[0]; if(a.type!=='NumericLiteral')return;
 const fn=resolveFn(p,cal.name); if(!fn)return; const acc=accessors.get(fn); if(!acc)return;
 const s=acc.get(a.value);
 if(s==null||s.includes('\ufffd')){bad++;console.error('BAD',cal.name,a.value,JSON.stringify(s));return;}
 p.replaceWith(t.stringLiteral(s)); n++;
}});
console.error('replaced',n,'bad',bad);
fs.writeFileSync('stage1.js',gen(ast,{comments:true}).code);
