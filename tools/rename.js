/* Final polish pass:
 *  - resolve any leftover inline string-accessor IIFEs:  (function(e){...91-char alphabet...})(N)
 *  - delete the now-dead decoder/accessor functions and the eF string table
 *  - rename a curated set of high-traffic aliases to readable names
 */
const fs = require('fs'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default,
  gen = require('@babel/generator').default, t = require('@babel/types');
const ast = parser.parse(fs.readFileSync(process.argv[2], 'utf8'), { sourceType: 'script', errorRecovery: true });

function mkDecode(alpha) {
  return function (e) {
    const s = '' + (e || ''); const out = []; let o = 0, i = 0, a = -1;
    for (let c = 0; c < s.length; c++) {
      const f = alpha.indexOf(s[c]);
      if (f === -1) continue;
      if (a < 0) { a = f; continue; }
      a += 91 * f; o |= a << i; i += ((8191 & a) > 88) ? 13 : 14;
      do { out.push(255 & o); o >>= 8; i -= 8; } while (i > 7);
      a = -1;
    }
    if (a > -1) out.push(255 & (o | (a << i)));
    return Buffer.from(out).toString('utf8');
  };
}

// the string table
let TABLE = null, TABLENAME = null;
traverse(ast, {
  VariableDeclarator(p) {
    const n = p.node;
    if (n.init && n.init.type === 'ArrayExpression' && n.init.elements.length > 500
      && n.init.elements.every(e => e && e.type === 'StringLiteral')) {
      TABLE = n.init.elements.map(e => e.value); TABLENAME = n.id.name;
    }
  },
});

// 1) inline accessor-IIFE calls:  (function(e){ ... DEC(eF[e]) ... })(N)
let inlined = 0;
traverse(ast, {
  CallExpression(p) {
    if (!/Function(Expression|Declaration)/.test(p.node.callee.type)) return;
    if (p.node.arguments.length !== 1 || p.node.arguments[0].type !== 'NumericLiteral') return;
    let alpha = null, usesTable = false;
    p.get('callee').traverse({
      StringLiteral(q) { if (q.node.value.length === 91 && !alpha) alpha = q.node.value; },
      Identifier(q) { if (q.node.name === TABLENAME) usesTable = true; },
    });
    if (!alpha || !usesTable || !TABLE) return;
    const s = mkDecode(alpha)(TABLE[p.node.arguments[0].value]);
    if (s == null || s.includes('�')) return;
    p.replaceWith(t.stringLiteral(s)); inlined++;
  },
});

// 2) drop dead decoder/accessor functions + the table
let dropped = 0;
for (let pass = 0; pass < 6; pass++) {
  let any = false;
  traverse(ast, {
    Function(p) {
      let alpha = null;
      p.traverse({ StringLiteral(q) { if (q.node.value.length === 91) alpha = q.node.value; } });
      if (!alpha) return;
      // only remove if the function is never *called* with a numeric literal anymore
      const name = p.node.id && p.node.id.name;
      if (p.parentPath.isCallExpression() && p.parentPath.node.callee === p.node) {
        // an immediately-invoked leftover; leave it, step 1 handles callable ones
      }
      if (name) {
        const b = p.scope.parent && p.scope.parent.getBinding(name);
        if (b && b.references === 0) { p.remove(); dropped++; any = true; return; }
      }
    },
    FunctionDeclaration(p) {
      const name = p.node.id && p.node.id.name; if (!name) return;
      const code = gen(p.node).code;
      if (!TABLENAME || !code.includes(TABLENAME + '[')) return;
      const b = p.scope.parent && p.scope.parent.getBinding(name);
      if (b && b.references === 0) { p.remove(); dropped++; any = true; }
    },
  });
  if (!any) break;
}
// the table itself (and its cache object) if unreferenced
traverse(ast, {
  VariableDeclarator(p) {
    const n = p.node.id.name;
    if (n !== TABLENAME) return;
    const b = p.scope.getBinding(n);
    if (b && b.references === 0) { p.remove(); dropped++; }
  },
});

// 3) curated renames
const RENAME = {
  fg: 'win', fh: 'doc', fi: 'nav', fj: 'loc',
  fk: 'T_UNDEF', fl: 'T_BOOL', fm: 'T_NUM', fn: 'T_STR', fo: 'T_FUNC', fp: 'T_OBJ',
  eH: 'typeOf', eO: 'bytesToStr',
  gg: 'b64decode', gh: 'b64encode', gi: 'b64decodeUtf8', gj: 'b64encodeUtf8',
  gs: 'jsonStringify', gx: 'jsonParse',
  fW: 'hmacMd5Hex', fN: 'md5Raw', fO: 'hmacMd5Raw', fP: 'toHex',
  hM: 'xorStr', hN: 'squeezeHash', uX: 'rot13',
  gN: 'APP_ID', gO: 'BUILD_BLOB', hg: 'getVid', lF: 'getClientUuid',
  kx: 'readCookie', kZ: 'writeCookie', kY: 'deleteCookie',
  qs: 'CDP_EVENT_NAMES', qp: 'WEBDRIVER_GLOBALS', qt: 'WEBDRIVER_ATTRS',
  wt: 'OPCODES_PRIMARY', ws: 'OPCODES_SECONDARY', wu: 'EVAL',
  wE: 'dispatchServerCommands', wD: 'parseCommandPayload',
  xy: 'buildSensorRequest', uL: 'encryptPayload', uH: 'derivePayloadKey',
  uM: 'interleaveKey', uJ: 'keyPositions',
  lB: 'getRunMode', sE: 'isJsChallengePage', qS: 'isHardChallengePage',
  mj: 'eventBus', mz: 'PX_PUBLIC_API', Ep: 'sensorState',
  lz: 'RUNMODE_PROP', lZ: 'CAPTCHA_CONTAINER_ID',
  ft: 'MODE_HARD_CHALLENGE', fu: 'MODE_JS_CHALLENGE', fv: 'MODE_COLLECTOR',
};
let renamed = 0;
traverse(ast, {
  Program(p) {
    // rename only in the scope where the binding is actually declared
    p.traverse({
      Scopable(q) {
        for (const from in RENAME) {
          const b = q.scope.getOwnBinding(from);
          if (!b) continue;
          if (q.scope.hasBinding(RENAME[from], true)) continue;
          q.scope.rename(from, RENAME[from]);
          renamed++;
        }
      },
    });
  },
});
console.error('inlined-leftovers', inlined, 'dropped', dropped, 'renamed', renamed);
fs.writeFileSync(process.argv[3], gen(ast, { comments: true }).code);
