const fs=require('fs'),parser=require('@babel/parser'),traverse=require('@babel/traverse').default,gen=require('@babel/generator').default,t=require('@babel/types');
const IN=process.argv[2],OUT=process.argv[3];
const ast=parser.parse(fs.readFileSync(IN,'utf8'),{sourceType:'script',errorRecovery:true});
function mkDecode(alpha){return function(e){const s=''+(e||'');const out=[];let o=0,i=0,a=-1;
 for(let c=0;c<s.length;c++){const f=alpha.indexOf(s[c]);if(f===-1)continue;if(a<0){a=f;continue;}
  a+=91*f;o|=a<<i;i+=((8191&a)>88)?13:14;do{out.push(255&o);o>>=8;i-=8;}while(i>7);a=-1;}
 if(a>-1)out.push(255&(o|(a<<i)));return Buffer.from(out).toString('utf8');};}
function resolveFn(path,name){const b=path.scope.getBinding(name);if(!b)return null;const n=b.path.node;
 if(n.type==='FunctionDeclaration')return n;if(n.type==='VariableDeclarator'&&n.init&&/Function/.test(n.init.type))return n.init;return null;}
// locate big table(s)
const tables=new Map();
traverse(ast,{VariableDeclarator(p){const n=p.node;
 if(n.init&&n.init.type==='ArrayExpression'&&n.init.elements.length>500&&n.init.elements.every(e=>e&&e.type==='StringLiteral'))
   tables.set(n.id.name,n.init.elements.map(e=>e.value));}});
console.error('tables',[...tables.keys()]);
// cache: fnNode -> alphabet
const alphaCache=new Map();
function findAlpha(fnPath){ // fnPath: NodePath of a Function
  if(alphaCache.has(fnPath.node))return alphaCache.get(fnPath.node);
  let a=null;
  fnPath.traverse({StringLiteral(q){if(q.node.value.length===91&&!a)a=q.node.value;}});
  if(!a&&fnPath.node.body&&fnPath.node.body.type==='BlockStatement'){}
  alphaCache.set(fnPath.node,a); return a;
}
// For a function path G, find alphabet used for table lookup inside it
function accessorAlpha(Gpath){
  let res=null,n=0;
  Gpath.traverse({CallExpression(q){
    if(q.node.arguments.length!==1)return;
    const arg=q.node.arguments[0];
    if(arg.type!=='MemberExpression'||!arg.computed||arg.object.type!=='Identifier')return;
    if(!tables.has(arg.object.name))return;
    const cal=q.node.callee; let alpha=null;
    if(/Function(Expression|Declaration)/.test(cal.type)) alpha=findAlpha(q.get('callee'));
    else if(cal.type==='Identifier'){const fn=resolveFn(q,cal.name); if(fn){ // need a path; search by node
        let fp=null; traverse(ast,{Function(z){if(z.node===fn)fp=z;}}); if(fp)alpha=findAlpha(fp);} }
    if(alpha){res={alpha,table:arg.object.name};n++;}
  }});
  return n===1?res:(res&&n>1?null:null);
}
const accMemo=new Map();
let done=0,skipped=0; const unres=[];
traverse(ast,{CallExpression(p){
 const cal=p.node.callee; if(cal.type!=='Identifier'||p.node.arguments.length!==1)return;
 const a=p.node.arguments[0]; if(a.type!=='NumericLiteral')return;
 const fn=resolveFn(p,cal.name); if(!fn)return;
 if(!accMemo.has(fn)){ let fp=null; traverse(ast,{Function(z){if(z.node===fn)fp=z;}});
   accMemo.set(fn, fp?accessorAlpha(fp):null); }
 const info=accMemo.get(fn); if(!info){return;}
 const tbl=tables.get(info.table); const raw=tbl[a.value];
 if(raw==null){skipped++;return;}
 const s=mkDecode(info.alpha)(raw);
 if(s.includes('\ufffd')){unres.push([cal.name,a.value]);skipped++;return;}
 p.replaceWith(t.stringLiteral(s)); done++;
}});
console.error('replaced',done,'skipped',skipped);
if(unres.length)console.error('unresolved sample',unres.slice(0,10));
fs.writeFileSync(OUT,gen(ast,{comments:true}).code);
