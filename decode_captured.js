// crack a captured px sensor post + the collector response
// node decode_captured.js <body.txt> [response.txt]
//
// does: sid tag blob -> session ts -> payload key -> strip key chars -> b64d -> utf8 -> xor50 -> events
// tolerates clipboard-eaten key chars (non-b64 chars sometimes vanish from devtools copies)
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const xorStr = (s, k) => { let o = ''; for (let i = 0; i < s.length; i++) o += String.fromCharCode(k ^ s.charCodeAt(i)); return o; };
const squeezeHash = (s) => { let t = '', n = ''; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); (c >= 48 && c <= 57) ? t += s[i] : n += c % 10; } return t + n; };
const hmacMd5Hex = (msg, key) => crypto.createHmac('md5', key).update(msg, 'binary').digest('hex');
function hG(msg, key) { const h = hmacMd5Hex(msg, key), sq = squeezeHash(h); let o = ''; for (let i = 0; i < sq.length; i += 2) o += sq[i]; return o; }
const b64e = (s) => Buffer.from(s, 'binary').toString('base64');
const b64d = (s) => Buffer.from(s, 'base64').toString('binary');
const uI = (a, b, c, d, e) => Math.floor((a - b) / (c - b) * (e - d) + d);
function keyPositions(key, bodyLen, cu) {
  const r = xorStr(b64e(cu), 10); const o = []; let max = -1;
  for (let a = 0; a < key.length; a++) { const c = Math.floor(a / r.length + 1), f = a >= r.length ? a % r.length : a, u = r.charCodeAt(f) * r.charCodeAt(c); if (u > max) max = u; }
  for (let l = 0; l < key.length; l++) { const s = Math.floor(l / r.length) + 1, h = l % r.length; let g = r.charCodeAt(h) * r.charCodeAt(s); if (g >= bodyLen) g = uI(g, 0, max, 0, bodyLen - 1); while (o.indexOf(g) !== -1) g++; o.push(g); }
  return o.sort((a, b) => a - b);
}
const derivePayloadKey = (sid) => xorStr(b64e(sid || '1604064986000'), 10);
const xu = (s) => escape(s).split('%uDB40%uDD').slice(1).reduce((acc, t) => acc + String.fromCharCode(parseInt(t.substr(0, 2), 16)), '');

function decryptPayload(payload, cu, sidTs) {
  const key = derivePayloadKey(sidTs);
  // +1: one key char usually gets eaten by the clipboard, we skip it below
  const bodyLen = payload.length + 1 - key.length;
  const pos = keyPositions(key, bodyLen, cu);
  const caretTrue = pos[1] - 1;
  const rem = pos.map((p, a) => p - 1 - (a !== 1 && p - 1 > caretTrue ? 1 : 0));
  const verified = pos.map((p, a) => a === 1 ? null : payload[rem[a]] === key[a]);
  const chars = payload.split('');
  for (let a = key.length - 1; a >= 0; a--) if (a !== 1) chars.splice(rem[a], 1);
  const body = chars.join('');
  const s = Buffer.from(body, 'base64').toString('utf8');
  return { key, rem, verified, json: xorStr(s, 50), body };
}

const raw = fs.readFileSync(process.argv[2] || 'body.txt', 'utf8').trim();
const respRaw = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8').trim() : null;
const params = {};
raw.split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1); });

console.log('='.repeat(70));
console.log(' captured px sensor request — decode + verify');
console.log('='.repeat(70));

console.log('\n[params]');
for (const k of Object.keys(params)) {
  if (k === 'payload') { console.log(`  ${k} = <${params[k].length} chars>`); continue; }
  console.log(`  ${k} = ${params[k]}`);
}

const sidParam = params.sid || '';
const m = sidParam.match(/^([0-9a-f-]+)([\uDB40][\uDD00-\uDD7F][\s\S]*)?$/);
const sidVisible = m ? m[1] : sidParam;
const tagBlob = m && m[2] ? m[2] : '';
console.log('\n[sid]');
console.log(`  visible : ${sidVisible}`);
let sidTs = '';
if (tagBlob) {
  sidTs = xu(tagBlob);
  console.log(`  hidden  : ${sidTs}   <- payload key material`);
}

console.log('\n[payload]');
const r = decryptPayload(params.payload, params.uuid, sidTs);
const okCount = r.verified.filter(v => v === true).length;
console.log(`  key        : ${JSON.stringify(r.key)}  (${r.key.length} chars)`);
console.log(`  key chars verified: ${okCount}/${r.key.length - 1}  (clipboard eats some, tolerated)`);
console.log(`  body len   : ${r.body.length}`);

let events = null;
try { events = JSON.parse(r.json); } catch (e) {
  // newer builds emit a binary string value strict json hates, salvage around it
  const cut = r.json.search(/,"[A-Za-z0-9+/]{11}=":[^"\[{0-9tfn]/);
  if (cut > 0) {
    try { events = JSON.parse(r.json.slice(0, cut).replace(/,$/, '') + '}]'); console.log('  (binary field cut — salvaged the rest)'); } catch (e2) { }
  }
}

if (events) {
  console.log(`  events     : ${events.length}`);
  events.forEach((ev, i) => {
    console.log(`\n  --- event ${i}: t=${ev.t}`);
    Object.keys(ev.d || {}).forEach(f => {
      let v = ev.d[f];
      if (typeof v === 'string' && v.length > 70) v = v.slice(0, 70) + `...(${ev.d[f].length})`;
      console.log(`    ${f.padEnd(16)} = ${JSON.stringify(v)}`);
    });
  });
  const pcCalc = hG(r.json, [params.uuid, params.tag, params.ft].join(':'));
  console.log(`\n  pc check: captured ${params.pc} / computed ${pcCalc} -> ${pcCalc === params.pc ? 'MATCH' : 'off (expected if json salvaged)'}`);
}

if (respRaw) {
  console.log('\n[response]');
  try {
    const j = JSON.parse(respRaw);
    for (const k of Object.keys(j)) {
      const v = j[k];
      if (typeof v === 'string' && v.length > 100) console.log(`  ${k} = <string ${v.length}>`);
      else console.log(`  ${k} = ${JSON.stringify(v)}`);
    }
    if (j.ob) {
      try {
        const dec = xorStr(Buffer.from(j.ob, 'base64').toString('binary'), 50);
        if (/^[\x20-\x7e\r\n]+$/.test(dec)) console.log(`  ob decoded:\n  ${dec.split('\n').slice(0, 30).join('\n  ')}`);
        else console.log(`  ob: xor50 variant didn't take, newer build scheme`);
      } catch (e) { console.log(`  ob decode failed: ${e.message}`); }
    }
  } catch (e) { console.log(`  parse err: ${e.message}`); }
}
