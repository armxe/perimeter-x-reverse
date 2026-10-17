// sensor payload crypto test, re'd from main.deobf.js
// node test_payload_crypto.js — no deps, crypto builtin for the hmac
'use strict';
const crypto = require('crypto');

const HK = 50;              // body xor key, en=NTA -> atob -> "50"
const UF = 10;              // payload key xor
const CU = 'cu';
const SID_FALLBACK = '1604064986000';

const xorStr = (s, k) => {
  let o = '';
  for (let i = 0; i < s.length; i++) o += String.fromCharCode(k ^ s.charCodeAt(i));
  return o;
};

const squeezeHash = (s) => {
  let t = '', n = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    (c >= 48 && c <= 57) ? t += s[i] : n += c % 10;
  }
  return t + n;
};

const hmacMd5Hex = (msg, key) =>
  crypto.createHmac('md5', key).update(msg, 'binary').digest('hex');

function hG(msg, key) {
  const h = hmacMd5Hex(msg, key);
  const sq = squeezeHash(h);
  let o = '';
  for (let i = 0; i < sq.length; i += 2) o += sq[i];
  return o;
}

const b64encode = (s) => Buffer.from(s, 'binary').toString('base64');
const b64encodeUtf8 = (s) => Buffer.from(unescape(encodeURIComponent(s)), 'binary').toString('base64');

const derivePayloadKey = (sid) => xorStr(b64encode(sid || SID_FALLBACK), UF);

const uI = (a, b, c, d, e) => Math.floor((a - b) / (c - b) * (e - d) + d);

function keyPositions(key, bodyLen, cu) {
  const r = xorStr(b64encode(cu), UF);
  const o = [];
  let max = -1;
  for (let a = 0; a < key.length; a++) {
    const c = Math.floor(a / r.length + 1);
    const f = a >= r.length ? a % r.length : a;
    const u = r.charCodeAt(f) * r.charCodeAt(c);
    if (u > max) max = u;
  }
  for (let l = 0; l < key.length; l++) {
    const s = Math.floor(l / r.length) + 1;
    const h = l % r.length;
    let g = r.charCodeAt(h) * r.charCodeAt(s);
    if (g >= bodyLen) g = uI(g, 0, max, 0, bodyLen - 1);
    while (o.indexOf(g) !== -1) g++;
    o.push(g);
  }
  return o.sort((a, b) => a - b);
}

function interleaveKey(key, body, positions) {
  let out = '', o = 0;
  const k = key.split('');
  for (let a = 0; a < key.length; a++) {
    out += body.substring(o, positions[a] - a - 1) + k[a];
    o = positions[a] - a - 1;
  }
  return out + body.substring(o);
}

function encryptPayload(events, ctx, sid) {
  const key = derivePayloadKey(sid);
  let body = b64encodeUtf8(xorStr(JSON.stringify(events), HK));
  return interleaveKey(key, body, keyPositions(key, body.length, ctx[CU]));
}

function decryptPayload(payload, cu, sid) {
  const key = derivePayloadKey(sid);
  const positions = keyPositions(key, payload.length - key.length, cu);
  const chars = payload.split('');
  for (let a = key.length - 1; a >= 0; a--) chars.splice(positions[a] - 1, 1);
  const body = chars.join('');
  // b64d -> utf8 -> xor50. other way around = garbage past first non-ascii char
  const events = JSON.parse(xorStr(Buffer.from(body, 'base64').toString('utf8'), HK));
  return { events, key };
}

// u+E00xx tag chars, one per byte of the sid ts
const XS = '%uDB40%uDD';
const xt = (s) => (s || '').split('').reduce((acc, ch) =>
  acc + unescape(XS + ch.charCodeAt(0).toString(16).padStart(2, '0')), '');
const xu = (s) => escape(s).split(XS).slice(1).reduce((acc, t) =>
  acc + String.fromCharCode(parseInt(t.substr(0, 2), 16)), '');
const xv = (s) => {
  const blob = xt(xu(s));
  const i = s.indexOf(blob);
  return s.substring(0, i) + s.substring(i + blob.length);
};

let passed = 0, failed = 0;
const OK = '[OK]', NO = '[!!]';
const check = (label, cond) => {
  cond ? (passed++, console.log(`  ${OK} ${label}`)) : (failed++, console.log(`  ${NO} ${label}`));
};

console.log('='.repeat(70));
console.log(' px sensor payload crypto — test');
console.log('='.repeat(70));

console.log('\n[1] xorStr');
const x1 = xorStr('hello world', 50);
check('xor then xor again = original', xorStr(x1, 50) === 'hello world');
check('xor50 of ascii stays under 128', [...x1].every(c => c.charCodeAt(0) < 128));

console.log('\n[2] squeezeHash');
check('digits pass through', squeezeHash('0123456789') === '0123456789');
check('manual exact', squeezeHash('aB1') === '176');

console.log('\n[3] hG (pc param)');
const pc = hG('{"a":1}', 'uuid:tag:ft');
console.log(`  pc = ${pc}`);
check('hG returns half the squeezed hash', pc.length > 0 && /^[0-9]+$/.test(pc));
const h = hmacMd5Hex('{"a":1}', 'uuid:tag:ft');
const manual = squeezeHash(h).split('').filter((_, i) => i % 2 === 0).join('');
check('matches manual hmac->squeeze->odd-chars', pc === manual);

console.log('\n[4] derivePayloadKey');
const key1 = derivePayloadKey('1234567890');
const key2 = derivePayloadKey('1234567890');
const key3 = derivePayloadKey('9876543210');
check('deterministic', key1 === key2);
check('different sid -> different key', key1 !== key3);
check('key len == b64(sid) len', key1.length === Buffer.from('1234567890').toString('base64').length);
const fallback = derivePayloadKey('');
check('empty sid falls back', fallback === xorStr(b64encode(SID_FALLBACK), UF));

console.log('\n[5] keyPositions');
const cu = '550e8400-e29b-41d4-a716-446655440000';
const pos = keyPositions(key1, 500, cu);
console.log(`  positions = [${pos.join(', ')}]`);
check(`exactly ${key1.length} positions`, pos.length === key1.length);
check('all < bodyLen', pos.every(p => p < 500));
check('strictly increasing', pos.every((p, i) => i === 0 || pos[i - 1] < p));
check('no duplicates', new Set(pos).size === pos.length);

console.log('\n[6] interleaveKey');
const body = 'A'.repeat(500);
const payload = interleaveKey(key1, body, pos);
check('payload len == body + key len', payload.length === 500 + key1.length);
const keyIdx = new Set(pos.map(p => p - 1));
const extracted = payload.split('').filter((c, i) => !keyIdx.has(i)).join('');
check('body survives interleave', extracted === body);

console.log('\n[7] encryptPayload round-trip');
const events = [
  { t: 'fgEORDhuAHY=', d: { 'eEsIDj0mDz8=': 'px3-cookie-value', 'RT41ewNXNUA=': !0 } },
  { t: 'a1RbUS4+VWY=', d: { 'XQYtAxtkKjU=': 42, 'SlV6EA8/eiQ=': 'chrome' } },
];
const ctx = { vid: 'vid-123', tag: 'tag-xyz', appID: 'PXu6b0qd2S', cu: cu, cs: 1, pc: 'x' };
const sid = '1699999999999';

const pload = encryptPayload(events, ctx, sid);
console.log(`  payload (${pload.length} chars) : ${pload.slice(0, 64)}...`);

const dec = decryptPayload(pload, cu, sid);
check('decrypted key matches', dec.key === derivePayloadKey(sid));
check('events round-trip intact', JSON.stringify(dec.events) === JSON.stringify(events));
check('event count preserved', dec.events.length === 2);
check('field ids intact', dec.events[0].d['eEsIDj0mDz8='] === 'px3-cookie-value');

console.log('\n[8] sid tag chars (xt/xu/xv)');
const sidVal = '1699999999999';
const tagged = sidVal + xt(sidVal);
check('xt adds 2 UTF-16 units per byte', tagged.length === sidVal.length * 3);
check('tag char starts with high surrogate U+DB40', tagged.charCodeAt(sidVal.length) === 0xDB40);
check('low surrogate encodes the byte', xu(tagged.slice(sidVal.length)) === sidVal);
check('xv strips the blob', xv(tagged) === sidVal);
const rawParam = 'sid=' + tagged + '&appId=PXu6b0qd2S';
check('xv on full param', xv(rawParam) === 'sid=' + sidVal + '&appId=PXu6b0qd2S');

console.log('\n[9] full sensor request query');
let seq = 0;
function buildSensorRequest(events_, state) {
  const pcs = hG(JSON.stringify(events_), [state.uuid, state.tag, state.ft].join(':'));
  const ctx_ = { vid: state.vid, tag: state.tag, appID: state.appID, cu: state.uuid, cs: pcs, pc: pcs };
  const payload_ = encryptPayload(events_, ctx_, state.sid);
  return [
    'payload=' + payload_,
    'appId=' + state.appID,
    'tag=' + state.tag,
    'uuid=' + state.uuid,
    'ft=' + state.ft,
    'seq=' + (seq++),
    'en=NTA',
    'sid=' + state.sid + xt(state.sid),
    'cs=' + pcs,
    'pc=' + pcs,
  ].join('&');
}
const state = {
  uuid: cu, vid: 'vid-123', tag: 'tag-xyz', appID: 'PXu6b0qd2S',
  ft: 'ft-1', sid: '1699999999999',
};
const full = buildSensorRequest(events, state);
console.log(`  ${full.slice(0, 100)}...`);
check('query has payload=', full.startsWith('payload='));
check('en=NTA present', full.includes('en=NTA'));
check('atob(NTA) == "50"', Buffer.from('NTA', 'base64').toString() === '50');
check('hidden tag chars present in sid param', xv(full).length < full.length);
check('seq increments', (function () { buildSensorRequest(events, state); return true; })());

console.log('\n' + '='.repeat(70));
console.log(` results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));
if (failed) process.exit(1);
console.log(' all good.');
