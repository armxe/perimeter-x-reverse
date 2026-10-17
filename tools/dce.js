const fs=require('fs'),parser=require('@babel/parser'),traverse=require('@babel/traverse').default,gen=require('@babel/generator').default;
let code=fs.readFileSync(process.argv[2],'utf8');
for(let pass=0;pass<12;pass++){
  const ast=parser.parse(code,{sourceType:'script',errorRecovery:true});
  let removed=0;
  traverse(ast,{
    FunctionDeclaration(p){const name=p.node.id&&p.node.id.name;if(!name)return;
      const b=p.scope.parent.getBinding(name);
      if(b&&b.references===0&&b.constantViolations.length===0){p.remove();removed++;}},
    VariableDeclarator(p){
      if(!p.node.init||(p.node.init.type!=='ArrayExpression'&&p.node.init.type!=='ObjectExpression'))return;
      if(p.node.init.type==='ArrayExpression'&&!p.node.init.elements.every(e=>e&&e.type==='StringLiteral'))return;
      if(p.node.init.type==='ObjectExpression'&&p.node.init.properties.length!==0)return;
      const b=p.scope.getBinding(p.node.id.name);
      if(b&&b.references===0&&b.constantViolations.length<=1){p.remove();removed++;}}
  });
  code=gen(ast,{comments:true}).code;
  console.error('pass',pass,'removed',removed);
  if(!removed)break;
}
fs.writeFileSync(process.argv[3],code);
