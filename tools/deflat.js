/* Static de-flattener for the PerimeterX state-machine ("VM") obfuscation.
 *
 * Shape of a flattened function:
 *
 *   function OUTER(realArgs...) {
 *     function INTERP() {
 *       for (var TMP, c1, c2, .., env, DUMMY = (TMP = slice(arguments),
 *              c1 = TMP[0], c2 = TMP[1], env = TMP[2]===undefined ? {L:{}} : TMP[2], extra = TMP[3]), T1, T2;
 *            c1 + c2 !== TERM;)
 *         with (env.ACTIVE || env) switch (c1 + c2) {
 *           case <numeric expr over counters/locals>: <body>; c1 += d1, c2 += d2; break;
 *           ...
 *           case ...: return RETFLAG = true, <value>;
 *         }
 *     }
 *     var RETFLAG, r = INTERP(a, b);
 *     if (RETFLAG) return r;
 *   }
 *
 * PC = sum(counters). Only numeric counter/local state influences control flow,
 * so the CFG can be recovered by symbolic execution of that numeric state alone.
 */
const fs = require('fs'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default,
  gen = require('@babel/generator').default, t = require('@babel/types');
const SRC = process.argv[2] || 'stage6.js';
const ast = parser.parse(fs.readFileSync(SRC, 'utf8'), { sourceType: 'script', errorRecovery: true });
const G = n => gen(n, { concise: true }).code;

function numOf(n) {
  if (!n) return null;
  if (n.type === 'NumericLiteral') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '-') { const v = numOf(n.argument); return v === null ? null : -v; }
  if (n.type === 'UnaryExpression' && n.operator === '+') return numOf(n.argument);
  return null;
}
// collect identifiers of a `a + b + c` sum
function sumIdents(n, acc = []) {
  if (!n) return acc;
  if (n.type === 'BinaryExpression' && n.operator === '+') { sumIdents(n.left, acc); sumIdents(n.right, acc); return acc; }
  if (n.type === 'Identifier') acc.push(n.name);
  return acc;
}

// ---------- discover machines ----------
const machines = [];
traverse(ast, {
  WithStatement(p) {
    const inner = p.getFunctionParent(); if (!inner) return;
    if (machines.find(m => m.inner.node === inner.node)) return;
    const outer = inner.parentPath.getFunctionParent(); if (!outer) return;
    const forP = p.findParent(x => x.isForStatement()); if (!forP) return;
    const test = forP.node.test;
    if (!test || test.type !== 'BinaryExpression') return;
    const counters = sumIdents(test.left);
    const term = numOf(test.right);
    if (!counters.length || term === null) return;

    // map counter -> arguments[] index, find env var + locals key
    const paramIdx = {}; let envName = null, localsKey = null, envIdx = null;
    let bigInit = null;
    for (const d of (forP.node.init.declarations || [])) if (d.init) bigInit = d.init;
    if (bigInit && bigInit.type === 'SequenceExpression') for (const e of bigInit.expressions) {
      if (e.type !== 'AssignmentExpression' || e.left.type !== 'Identifier') continue;
      const R = e.right;
      if (R.type === 'MemberExpression' && R.computed && R.property.type === 'NumericLiteral') paramIdx[e.left.name] = R.property.value;
      if (R.type === 'ConditionalExpression') {
        envName = e.left.name;
        const ob = [R.consequent, R.alternate].find(x => x.type === 'ObjectExpression');
        if (ob && ob.properties.length) localsKey = ob.properties[0].key.name;
        const mi = [R.consequent, R.alternate].find(x => x.type === 'MemberExpression');
        if (mi) envIdx = mi.property.value;
      }
    }
    const body = p.node.body;
    let sw = body.type === 'SwitchStatement' ? body : ((body.body || []).find(s => s.type === 'SwitchStatement') || null);
    if (!sw) sw = t.switchStatement(test.left, [t.switchCase(null, body.type === 'BlockStatement' ? body.body : [body])]);
    machines.push({
      inner, outer, forP, counters, paramIdx, envName, localsKey, envIdx, sw, term,
      interp: inner.node.id ? inner.node.id.name : null,
      name: (outer.node.id && outer.node.id.name)
        || (outer.parentPath.node.type === 'VariableDeclarator' ? outer.parentPath.node.id.name
          : (outer.parentPath.node.type === 'AssignmentExpression' ? G(outer.parentPath.node.left) : '?')),
      line: p.node.loc.start.line, nonSwitchBody: sw ? null : body,
      withObj: G(p.node.object),
    });
  },
});

// entry points: every call to the interpreter
for (const m of machines) {
  const entries = [];
  m.outer.traverse({
    CallExpression(q) {
      if (q.node.callee.type !== 'Identifier' || q.node.callee.name !== m.interp) return;
      const vals = {}; let ok = true;
      for (const c of m.counters) {
        const i = m.paramIdx[c];
        const v = numOf(q.node.arguments[i]);
        if (v === null) { ok = false; break; }
        vals[c] = v;
      }
      if (ok) entries.push({ vals, call: G(q.node), extra: q.node.arguments.map(G) });
    },
  });
  m.entries = entries;
}

// ---------- numeric symbolic evaluator ----------
function mkEval(st) {
  return function ev(n) {
    switch (n.type) {
      case 'NumericLiteral': return n.value;
      case 'BooleanLiteral': return n.value;
      case 'UnaryExpression': {
        const v = ev(n.argument); if (v === undefined) return undefined;
        if (n.operator === '-') return -v;
        if (n.operator === '+') return +v;
        if (n.operator === '!') return !v;
        return undefined;
      }
      case 'Identifier': return (n.name in st.c) ? st.c[n.name] : undefined;
      case 'MemberExpression': { const code = G(n); return (code in st.l) ? st.l[code] : undefined; }
      case 'BinaryExpression': {
        const a = ev(n.left), b = ev(n.right);
        if (a === undefined || b === undefined) return undefined;
        const ops = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '%': (x, y) => x % y,
          '==': (x, y) => x == y, '===': (x, y) => x === y, '!=': (x, y) => x != y, '!==': (x, y) => x !== y,
          '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y };
        return ops[n.operator] ? ops[n.operator](a, b) : undefined;
      }
      case 'LogicalExpression': {
        const a = ev(n.left); if (a === undefined) return undefined;
        if (n.operator === '&&') return a ? ev(n.right) : a;
        if (n.operator === '||') return a ? a : ev(n.right);
        return undefined;
      }
      case 'ConditionalExpression': {
        const c = ev(n.test); if (c === undefined) return undefined;
        return c ? ev(n.consequent) : ev(n.alternate);
      }
    }
    return undefined;
  };
}
const cloneSt = st => ({ c: Object.assign({}, st.c), l: Object.assign({}, st.l), arr: Object.assign({}, st.arr) });

function applyExpr(e, st, m, sink) {
  if (e.type === 'SequenceExpression') { for (const x of e.expressions) applyExpr(x, st, m, sink); return; }
  if (e.type === 'UpdateExpression' && e.argument.type === 'Identifier' && m.counters.includes(e.argument.name)) {
    st.c[e.argument.name] += (e.operator === '++' ? 1 : -1); return;
  }
  if (e.type === 'AssignmentExpression') {
    const Lc = G(e.left);
    if (e.left.type === 'Identifier' && m.counters.includes(e.left.name) && ['+=', '-=', '='].includes(e.operator)) {
      const v = mkEval(st)(e.right);
      if (v !== undefined) {
        if (e.operator === '+=') st.c[e.left.name] += v;
        else if (e.operator === '-=') st.c[e.left.name] -= v;
        else st.c[e.left.name] = v;
        return;
      }
    }
    // env.active = env.something  (scope switch bookkeeping)
    if (e.left.type === 'MemberExpression' && e.left.object.type === 'Identifier' && e.left.object.name === m.envName
      && e.right.type === 'MemberExpression' && e.right.object.type === 'Identifier' && e.right.object.name === m.envName) return;
    // TMP = [n, n, n]
    if (e.right.type === 'ArrayExpression' && e.right.elements.length && e.right.elements.every(x => numOf(x) !== null)) {
      st.arr[Lc] = e.right.elements.map(numOf); return;
    }
    // env.L.x = TMP[i]
    if (e.right.type === 'MemberExpression' && e.right.computed && e.right.property.type === 'NumericLiteral') {
      const base = G(e.right.object);
      if (st.arr[base]) { st.l[Lc] = st.arr[base][e.right.property.value]; return; }
    }
    // env.L.x = <numeric>
    const v = mkEval(st)(e.right);
    if (v !== undefined && e.left.type === 'MemberExpression' && Lc.startsWith(m.envName + '.' + m.localsKey + '.')) {
      st.l[Lc] = v; return;
    }
  }
  sink.push(t.expressionStatement(e));
}

function foldNode(node, st) {
  let file;
  try { file = parser.parse(G(node), { errorRecovery: true, allowReturnOutsideFunction: true }); }
  catch (e) { return G(node); }
  traverse(file, {
    Identifier(p) {
      if (!(p.node.name in st.c)) return;
      const pp = p.parentPath;
      if (pp.isMemberExpression() && pp.node.property === p.node && !pp.node.computed) return;
      if (pp.isObjectProperty() && pp.node.key === p.node) return;
      if (pp.isAssignmentExpression() && pp.node.left === p.node) return;
      if (pp.isUpdateExpression()) return;
      if (pp.isVariableDeclarator() && pp.node.id === p.node) return;
      if (pp.isFunction()) return;
      p.replaceWith(t.valueToNode(st.c[p.node.name]));
    },
    MemberExpression: { exit(p) { const code = G(p.node); if (code in st.l) p.replaceWith(t.valueToNode(st.l[code])); } },
  });
  for (let i = 0; i < 6; i++) traverse(file, {
    BinaryExpression: {
      exit(p) {
        const ln = numOf(p.node.left), rn = numOf(p.node.right);
        if (ln === null || rn === null) return;
        const ops = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b };
        const cmp = { '==': (a, b) => a == b, '===': (a, b) => a === b, '!=': (a, b) => a != b, '!==': (a, b) => a !== b,
          '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };
        if (ops[p.node.operator]) {
          const v = ops[p.node.operator](ln, rn);
          p.replaceWith(t.valueToNode(v));
        } else if (cmp[p.node.operator]) p.replaceWith(t.booleanLiteral(cmp[p.node.operator](ln, rn)));
      },
    },
  });
  return G(file.program.body.length === 1 ? file.program.body[0] : file.program);
}

function subtreeHasJump(n) {
  let f = false;
  const walk = x => {
    if (!x || typeof x !== 'object' || f) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.type === 'BreakStatement' || x.type === 'ReturnStatement') { f = true; return; }
    if (/Function/.test(x.type || '')) return;
    for (const k in x) if (k !== 'loc' && k !== 'start' && k !== 'end' && k !== 'leadingComments' && k !== 'trailingComments') walk(x[k]);
  };
  walk(n);
  return f;
}

function runBlock(body, st, m) {
  const real = []; const succ = []; let ended = false;
  const state = cloneSt(st);
  const sink = guard => ({ push: n => real.push({ node: n, guard }) });
  function walk(list, guard) {
    for (const s of list) {
      if (ended) return;
      if (s.type === 'BreakStatement' && !s.label) { succ.push({ cond: guard, st: cloneSt(state) }); if (!guard) ended = true; return; }
      if (s.type === 'ReturnStatement') { real.push({ node: s, guard }); if (!guard) ended = true; return; }
      if (s.type === 'ExpressionStatement') { applyExpr(s.expression, state, m, sink(guard)); continue; }
      if (s.type === 'IfStatement' && !s.alternate && subtreeHasJump(s.consequent)) {
        let test = s.test;
        if (test.type === 'SequenceExpression') {
          const pre = test.expressions.slice(0, -1);
          for (const x of pre) applyExpr(x, state, m, sink(guard));
          test = test.expressions[test.expressions.length - 1];
        }
        const stat = mkEval(state)(test);
        if (stat === false) continue;                       // opaque predicate: never taken
        const saved = cloneSt(state);
        walk(s.consequent.type === 'BlockStatement' ? s.consequent.body : [s.consequent], stat === undefined ? test : null);
        if (stat !== undefined) return;                     // statically taken
        state.c = saved.c; state.l = saved.l; state.arr = saved.arr;
        continue;
      }
      real.push({ node: s, guard });
    }
  }
  walk(body, null);
  if (!ended) succ.push({ cond: null, st: cloneSt(state), implicit: true });
  return { real, succ };
}

function trace(m, entry, labelPrefix) {
  const labels = new Map(); let nextL = 0;
  const key = st => m.counters.map(c => st.c[c]).join(',') + '#' + JSON.stringify(st.l);
  const lbl = st => { const k = key(st); if (!labels.has(k)) labels.set(k, labelPrefix + (nextL++)); return labels.get(k); };
  const st0 = { c: Object.assign({}, entry.vals), l: {}, arr: {} };
  const work = [st0]; const seen = new Set(); const blocks = [];
  lbl(st0);
  let guardN = 0;
  while (work.length) {
    if (++guardN > 400) { blocks.push({ lbl: 'OVERFLOW', pc: -1, lines: ['/* trace overflow */'], succ: [] }); break; }
    const st = work.shift(); const k = key(st);
    if (seen.has(k)) continue; seen.add(k);
    const myLbl = lbl(st);
    const pc = m.counters.reduce((a, c) => a + st.c[c], 0);
    if (pc === m.term) { blocks.push({ lbl: myLbl, pc, lines: ['/* for-test fails: machine stops, wrapper returns undefined */'], succ: [] }); continue; }
    const ev = mkEval(st); let idx = -1, def = -1;
    for (let i = 0; i < m.sw.cases.length; i++) {
      const c = m.sw.cases[i];
      if (!c.test) { def = i; continue; }
      if (ev(c.test) === pc) { idx = i; break; }
    }
    if (idx < 0) idx = def;
    if (idx < 0) { blocks.push({ lbl: myLbl, pc, lines: [`/* unreachable: no case matches pc=${pc} */`], succ: [] }); continue; }
    let body = [];
    for (let i = idx; i < m.sw.cases.length; i++) {
      body = body.concat(m.sw.cases[i].consequent);
      if (m.sw.cases[i].consequent.length) break;
    }
    const snap = cloneSt(st);
    const { real, succ } = runBlock(body, st, m);
    const lines = real.map(r => (r.guard ? 'if (' + foldNode(t.expressionStatement(r.guard), snap).replace(/;$/, '') + ') ' : '')
      + foldNode(r.node, snap));
    blocks.push({
      lbl: myLbl, pc, lines,
      succ: succ.map(s => ({ cond: s.cond ? foldNode(t.expressionStatement(s.cond), snap).replace(/;$/, '') : null, target: lbl(s.st), implicit: s.implicit })),
    });
    for (const s of succ) if (!seen.has(key(s.st))) work.push(s.st);
  }
  const out = [];
  for (const b of blocks) {
    out.push(`  ${b.lbl}:   /* pc=${b.pc} */`);
    b.lines.forEach(l => out.push('      ' + l));
    if (!b.succ.length) out.push('      -- end of block (no jump) --');
    else b.succ.forEach(s => out.push('      ' + (s.cond ? `if (${s.cond}) ` : '') + `goto ${s.target}`+(s.implicit?'   /* fall out of switch */':'')));
  }
  return out.join('\n');
}

const out = [];
for (const m of machines) {
  out.push('='.repeat(100));
  out.push(`FUNCTION ${m.name}(${m.outer.node.params.map(p => p.name || G(p)).join(', ')})      [src line ${m.line}]`);
  out.push(`  interp=${m.interp}  counters=[${m.counters}] argIdx=${JSON.stringify(m.paramIdx)} term=${m.term} env=${m.envName}.${m.localsKey} with=${m.withObj}`);
  if (!m.entries.length) { out.push('  !! no numeric entry point found'); out.push('  ' + G(m.outer.node)); out.push(''); continue; }
  m.entries.forEach((e, i) => {
    out.push(`  --- entry #${i}: ${e.call.slice(0, 160)} ---`);
    try { out.push(trace(m, e, 'E' + i + '_L')); } catch (err) { out.push('  TRACE ERROR: ' + err.message); }
  });
  out.push('');
}
fs.writeFileSync('vm_cfg.txt', out.join('\n'));
console.log('machines', machines.length, '-> vm_cfg.txt', fs.statSync('vm_cfg.txt').size);
