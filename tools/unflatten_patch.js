/* Replace each control-flow-flattened function with the structured equivalent
 * recovered by deflat.js (see vm_cfg.txt). Matching is done on the *outer*
 * wrapper function node, so the surrounding lexical scope (and therefore the
 * eG()/gg() string accessors still referenced in the bodies) is preserved.
 */
const fs = require('fs'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default,
  gen = require('@babel/generator').default;

const REPL = {
  // ---- qJ: install one-shot listeners for the "driver-*" CDP probe events ----
  qJ: `function qJ(report) {
    var handlers = {};
    var onProbe = function (eventIndex) {
      if (!handlers) return;
      for (var i = 0; i < qs.length; i++) {
        var ev = qs[i];
        fh.removeEventListener(ev, handlers[ev]);
      }
      handlers = null;
      report("PX11353", eventIndex);
      qQ();
    };
    for (var j = 0; j < qs[eG(191)]; j++) {
      var name = qs[j];
      handlers[name] = onProbe.bind(null, j);
      fh["addEventListener"](name, handlers[name]);
    }
  }`,

  // ---- qR: arm the periodic sensor-collection timer ----
  qR: `function qR(unused, a, b, immediate) {
    qx = false;
    qy = qO.bind(null, a, b);
    qy(immediate);
    if (!immediate) qz = setInterval(qy, qw);
  }`,

  // ---- ve: run the "stealth automation" probe battery ----
  ve: `function ve(out) {
    vp(out);
    vq(out);
    vs(out);
    vt(out);
    return vv(out);
  }`,

  // ---- vx: Function.prototype.toString on a native getter, reject if patched ----
  vx: `function vx(win, fn) {
    var src;
    if (!fn) return null;
    try {
      src = win["Function"][eG(238)][eG(270)][eG(139)](fn);
      if (src["indexOf"](uX(eG(434))) === -1) return src;
    } catch (e) {
      return src;
    }
    return null;
  }`,

  // ---- wB: "is this payload a non-string JSON value?" guard ----
  wB: `function wB(raw) {
    if (!(raw && raw["length"])) return true;
    var parsed = wD(raw);
    if (!parsed) return true;
    return !(eH(parsed) === fn);
  }`,

  // ---- wD: safe JSON parse, returning the inner payload ----
  wD: `function wD(raw) {
    var obj = null;
    try {
      obj = gx(raw);
    } catch (e) {
      return false;
    }
    if (obj && fp === eH(obj)) return obj.do || obj.ob;
    return false;
  }`,

  // ---- wE: dispatcher for the server-pushed "ff" (feature/command) list ----
  wE: `function wE(commands, secondary) {
    if (!commands) return;
    var queue = [];
    var firstCmd = void 0;
    for (var i = 0; i < commands["length"]; i++) {
      var raw = commands[i];
      if (!raw) continue;
      var parts = raw.split("|");
      var opcode = parts[eG(320)]();
      var impl = secondary ? ws[opcode] : wt[opcode];
      if (parts[0] === kf[ia]) {
        firstCmd = eK(eK({}, jJ, opcode), jx, parts);
        continue;
      }
      if (fo === eH(impl)) {
        if (opcode === wp || opcode === wo || opcode === wq)
          queue[eG(459)](eK(eK({}, jJ, opcode), jx, parts));
        else
          queue.push(eK(eK({}, jJ, opcode), jx, parts));
      }
    }
    if (firstCmd) queue.unshift(firstCmd);
    for (var k = 0; k < queue["length"]; k++) {
      var cmd = queue[k];
      try {
        var handler = secondary ? ws[cmd[jJ]] : wt[cmd[jJ]];
        handler[eG(229)](eK({}, jI, queue), cmd[jx]);
      } catch (e) {
        kM(e, jL[iw]);
      }
    }
  }`,

  // ---- wP: "bake" opcode - write a cookie and fire the enrich hook ----
  wP: `function wP(name, ttl, value, flag, extra) {
    if (he() === fg[eG(462)]) kZ(name, ttl, value, flag);
    if (fg._pxPreventAnalyticsCookie === true || "true" === fg._pxPreventAnalyticsCookie) kY(name);
    return mj.trigger("enrich", value, name, ttl, extra);
  }`,

  // ---- xc: pick the highest-versioned bake command out of the queue ----
  xc: `function xc(queue) {
    var version = function (entry) {
      return parseInt(entry[0].slice(3), 10) || 0;
    };
    var firstArray = function (obj) {
      return Object["keys"](obj).map(function (k) {
        return obj[k];
      })["filter"](Array.isArray)[0];
    };
    var sorted = queue.filter(function (e) {
        return e[jJ] === wp || e[jJ] === wo;
      }).map(firstArray).filter(Boolean)[eG(368)](function (a, b) {
        return version(b) - version(a);
      })[eG(467)](function (e) {
        return e["slice"](0, 3);
      });
    var split = od(sorted);
    var head = split[0];
    var rest = split.slice(1);
    var triple = ob(head === void 0 ? [] : head, 3);
    var out = {};
    out.name = triple[0];
    out["ttl"] = triple[1];
    out["value"] = triple[2];
    out["secondaryBakes"] = rest;
    return out;
  }`,

  // ---- xf: store / bake the PX token depending on multi-domain mode ----
  xf: `function xf(token, flag) {
    if (!token) return;
    if (!wm()) return nj(token, flag);
    if (kx(mf)) return;
    ni(token);
  }`,

  // ---- yx: "window.chrome looks faked" heuristic ----
  yx: `function yx() {
    if (!ye) return;
    if (!hE(ye)) return true;
    if (ye[yf] && !hE(ye[yf])) return true;
    if (ye[yg] && !hE(ye[yg])) return true;
  }`,

  // ---- zQ: add the storage/session identifiers to the payload ----
  zQ: `function zQ(out) {
    var sess = nm();
    var vid = lF();
    try {
      vid && (out[eG(748)] = fW(vid, fi.userAgent));
      out[eG(749)] = nu();
      hg() && (out["dW5FKzMDRh8="] = fW(hg(), fi.userAgent));
      sess && (out[eG(751)] = fW(sess, fi.userAgent));
      out["Ah0yWEdyNWs="] = nH();
      out["VQ4lCxBiKzs="] = kq(kf[il]) || void 0;
    } catch (e) {}
  }`,

  // ---- zV: vendor-prefix feature detection (rAF / matchesSelector / performance) ----
  zV: `function zV(out) {
    if (!mm) return;
    try {
      var prefixes = ["", "ms", "o", "webkit", "moz"];
      for (var i = 0; i < prefixes["length"]; i++) {
        var p = prefixes[i];
        var rafName = "" === p ? "requestAnimationFrame" : p + "RequestAnimationFrame";
        var perfName = "" === p ? "performance" : p + "Performance";
        var matchName = "" === p ? "matches" : p + "MatchesSelector";
        (fg.hasOwnProperty(rafName) || fg[rafName]) && (dC = true);
        ("undefined" == typeof Element ? "undefined" : eH(Element)) !== fk
          && Element.prototype[eG(226)](matchName)
          && hF(Element.prototype[matchName]) && (dD = true);
        fg[perfName] && (dE = !!fg[perfName]["timing"], dF = eH(fg[perfName].getEntries) === fo);
      }
    } catch (e) {}
    out["Bhk2XENzMmg="] = dC;
    out["GwRrAV5taTU="] = dD;
    out["WiVqIBxKbxA="] = dF;
    return out[eG(801)] = dE;
  }`,

  // ---- Aj: does `new Audio()` expose addEventListener ? ----
  Aj: `function Aj() {
    var ok = false;
    try {
      var el = new Audio();
      el && eH(el.addEventListener) === fo && (ok = true);
    } catch (e) {}
    return ok;
  }`,

  // ---- Al: navigator.plugins names (capped at zv == 30) ----
  Al: `function Al() {
    var names = [];
    try {
      for (var i = 0; i < fi.plugins.length && i < zv; i++) names.push(fi["plugins"][i].name);
    } catch (e) {}
    return names;
  }`,

  // ---- Dw: poll `cond` every `interval` ms until true, give up after `timeout` ----
  Dw: `function Dw(cond, onReady, interval, timeout) {
    var bail;
    var iv = setInterval(function () {
      try {
        if (cond()) {
          clearInterval(iv);
          clearTimeout(bail);
          onReady();
        }
      } catch (e) {}
    }, interval);
    return bail = setTimeout(function () {
      clearInterval(iv);
    }, timeout);
  }`,
};

const ast = parser.parse(fs.readFileSync(process.argv[2], 'utf8'), { sourceType: 'script', errorRecovery: true });

// map outer wrapper node -> name
const targets = new Map();
traverse(ast, {
  WithStatement(p) {
    const inner = p.getFunctionParent(); if (!inner) return;
    const outer = inner.parentPath.getFunctionParent(); if (!outer) return;
    let name = outer.node.id && outer.node.id.name;
    if (outer.parentPath.node.type === 'VariableDeclarator') name = outer.parentPath.node.id.name;
    if (!name) return;
    if (!targets.has(outer.node)) targets.set(outer.node, { name, path: outer });
  },
});

let done = 0; const missing = [];
for (const [node, info] of targets) {
  const src = REPL[info.name];
  if (!src) { missing.push(info.name); continue; }
  const fn = parser.parse(src, { errorRecovery: true }).program.body[0];
  node.params = fn.params;
  node.body = fn.body;
  done++;
}
console.error('replaced', done, 'of', targets.size, 'missing:', missing);
fs.writeFileSync(process.argv[3], gen(ast, { comments: true }).code);
