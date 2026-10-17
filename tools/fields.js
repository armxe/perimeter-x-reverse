/* Build a "payload field id -> what is collected" table by looking at every
 * assignment whose property is one of the opaque 12-char base64 field ids.
 */
const fs = require('fs'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default,
  gen = require('@babel/generator').default;
const ast = parser.parse(fs.readFileSync(process.argv[2] || 'stage11.js', 'utf8'), { sourceType: 'script', errorRecovery: true });
const G = n => gen(n, { concise: true }).code;
const ID = /^[A-Za-z0-9+/]{11}=$/;

const map = new Map();
function add(key, what, fn) {
  if (!map.has(key)) map.set(key, []);
  const a = map.get(key);
  if (a.length < 4 && !a.find(x => x.what === what)) a.push({ what, fn });
}
traverse(ast, {
  AssignmentExpression(p) {
    const L = p.node.left;
    if (L.type !== 'MemberExpression' || !L.computed) return;
    if (L.property.type !== 'StringLiteral' || !ID.test(L.property.value)) return;
    const f = p.getFunctionParent();
    const fname = f && f.node.id ? f.node.id.name : (f ? '<anon@' + (f.node.loc ? f.node.loc.start.line : '?') + '>' : 'top');
    add(L.property.value, G(p.node.right).slice(0, 150), fname);
  },
  ObjectProperty(p) {
    const k = p.node.key;
    if (k.type !== 'StringLiteral' || !ID.test(k.value)) return;
    const f = p.getFunctionParent();
    const fname = f && f.node.id ? f.node.id.name : 'top';
    add(k.value, G(p.node.value).slice(0, 150), fname);
  },
});
const lines = [];
lines.push(`# Payload field ids found: ${map.size}\n`);
for (const [k, v] of [...map.entries()].sort()) {
  lines.push(k);
  v.forEach(x => lines.push(`    <- ${x.what}      [in ${x.fn}]`));
}
fs.writeFileSync('fields.txt', lines.join('\n'));
console.log('fields:', map.size);
