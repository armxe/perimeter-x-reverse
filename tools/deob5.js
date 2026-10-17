/* Inline the remaining "cheap" string transforms:
 *   gg(b64)  -> atob(b64)                  (latin1)
 *   gi(b64)  -> decodeURIComponent(escape(atob(b64)))  (utf-8)
 *   uX(s)    -> rot13(s)
 * Each is resolved through the scope chain so shadowed names are safe.
 */
const fs = require('fs'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default,
  gen = require('@babel/generator').default, t = require('@babel/types');
const ast = parser.parse(fs.readFileSync(process.argv[2], 'utf8'), { sourceType: 'script', errorRecovery: true });

const b64 = s => Buffer.from(s, 'base64');
const latin1 = s => b64(s).toString('latin1');
const utf8 = s => b64(s).toString('utf8');
const rot13 = s => s.replace(/[A-Za-z]/g, c => String.fromCharCode(c.charCodeAt(0) + (c.toUpperCase() <= 'M' ? 13 : -13)));

function resolveFn(path, name, d = 0) {
  if (d > 8) return null;
  const b = path.scope.getBinding(name); if (!b) return null;
  const n = b.path.node;
  if (n.type === 'FunctionDeclaration') return n;
  if (n.type === 'VariableDeclarator' && n.init) {
    if (/Function/.test(n.init.type)) return n.init;
    if (n.init.type === 'Identifier') return resolveFn(b.path, n.init.name, d + 1);
  }
  return null;
}

// locate the three helpers by their bodies
const kinds = new Map(); // node -> kind
traverse(ast, {
  FunctionDeclaration(p) {
    const c = gen(p.node).code.replace(/\s+/g, ' ');
    if (c.length > 300) return;
    if (/return \w+ === \w+ \? \w+\(e\) : \w+\(e\);/.test(c) && /function (gg|\w+)\(e\)/.test(c)) {
      // gg / gh shape: decide by which fallback it calls (encoder has btoa-like body)
    }
    if (/\[A-Za-z\]/.test(c) && /toUpperCase\(\) <= "M"/.test(c)) kinds.set(p.node, 'rot13');
    if (/decodeURIComponent\(\w+\.escape\(\w+\(e\)\)\)/.test(c)) kinds.set(p.node, 'b64utf8');
  },
});
// gg: `function X(e){ return A === B ? C(e) : D(e); }` where C is atob
traverse(ast, {
  FunctionDeclaration(p) {
    const body = p.node.body.body;
    if (body.length !== 1 || body[0].type !== 'ReturnStatement') return;
    const a = body[0].argument;
    if (!a || a.type !== 'ConditionalExpression') return;
    const c = a.consequent, alt = a.alternate;
    if (c.type !== 'CallExpression' || alt.type !== 'CallExpression') return;
    if (c.callee.type !== 'Identifier') return;
    const b = p.scope.getBinding(c.callee.name);
    if (!b || b.path.node.type !== 'VariableDeclarator' || !b.path.node.init) return;
    const init = gen(b.path.node.init).code;
    if (/atob/.test(init)) kinds.set(p.node, 'b64');
  },
});
console.error('helpers:', [...kinds.values()]);

const counts = {};
let n = 0;
traverse(ast, {
  CallExpression(p) {
    const cal = p.node.callee;
    if (cal.type !== 'Identifier' || p.node.arguments.length !== 1) return;
    const a = p.node.arguments[0];
    if (a.type !== 'StringLiteral') return;
    const fn = resolveFn(p, cal.name); if (!fn) return;
    const kind = kinds.get(fn); if (!kind) return;
    let s;
    try {
      if (kind === 'b64') s = latin1(a.value);
      else if (kind === 'b64utf8') s = utf8(a.value);
      else s = rot13(a.value);
    } catch (e) { return; }
    if (s == null || /�/.test(s)) return;
    if (kind !== 'rot13' && !/^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(s)) return;
    p.replaceWith(t.stringLiteral(s));
    counts[kind] = (counts[kind] || 0) + 1; n++;
  },
});
console.error('inlined', n, JSON.stringify(counts));
fs.writeFileSync(process.argv[3], gen(ast, { comments: true }).code);
