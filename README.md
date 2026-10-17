# px-reverse

static reverse of a perimetery / human bot defender client sensor. `main.min.js`, 315kb, 6 lines of minified hell. app id `PXu6b0qd2S` (walmart.com build). comes bundled w/ the code defender module too.

deobfuscated the whole thing, all 5 layers undone, sensor crypto re'd in plain node and checked against a real captured request. nothing was ever sent to px infra — all static + local.
work is half done, but can be used to complete the work and finish infrastructure.

## files

| file | what |
|---|---|
| `main.min.js` | the og sample |
| `out/main.deobf.js` | deobf'd, beautified, 13.4k lines, syntax valid |
| `out/vm_cfg.txt` | cfgs of the 16 flattened "vm" fns |
| `out/fields.txt` | 423 payload field ids -> what fills them |
| `out/strings.txt` | 2889 decoded strings |
| `tools/*.js` | the babel deobf pipeline |
| `test_payload_crypto.js` | crypto round-trip test, 31 asserts |
| `decode_captured.js` | crack any captured sensor post + response |
| `captured_body.txt` | real walmart capture (seq=5) |
| `captured_response.txt` | matching response |
| `REVERSE-ENGINEERING.md` | the full writeup |

## the 5 layers

1. **base-91 string table** — one shared 1124-entry table but 21 different alphabets. every module has its own decoder + accessor. scope-aware resolution or u get garbage (1590 strings inlined)
2. **opaque predicates** — `"<literal>" in <emptyFn>` is always false. 12 decoy blocks, one of them contains a fake vm's source lmao
3. **cf flattening** — 16 fns as dispatch loops. pc = sum of 2-4 counters, case labels are *expressions*, locals in a `with` object, returns via side-channel flag. one symbolic executor handles all of them (`tools/deflat.js`)
4. **code defender sub-bundle** — nested second bundle, `f0x<hex>` names, atob+xor-first-byte cipher (695 strings)
5. **atob / rot13** misc (293 strings)

~2500 strings total, 16 vms, 12 decoys dropped.

## the payload

what actually gets posted to the collector. events pile up as `{t: "<tag>", d: {"<fieldId>": val, ...}}`, then per request:

```
key  = xor10(b64(sid_ts))              // sid_ts = session start ts in ms
body = b64_utf8(xor50(json(events)))   // 50 hinted by en=NTA (atob -> "50")
res  = interleave(key, body, pos)      // key chars spliced INTO the body
```

`keyPositions` walks the key computing `r[h] * r[floor(l/len)+1]` from the xored b64 client uuid, remaps anything >= bodylen w/ a linear map, dedupes by ++. sorted positions = where key chars land. final index of key char `a` in the payload = `pos[a] - 1`.

to decrypt: strip key chars, un-b64, **utf8-recombine then** xor50 charwise. yes the order matters, the bundle does `b64encodeUtf8(xorStr(...))` so the inverse is b64d -> utf8 -> xor. backwards = garbage past the first non-ascii char. took me a while.

### the sid trick

`sid` param = `<uuid><xt(sid_ts)>`. `xt` re-encodes each byte of the session ts as a u+E00xx tag char (surrogate pairs, renders as nothing). the tag blob IS the key material — verified on the live capture, it hides `1792254544149`. any proxy normalizing non-printables silently kills the param. clever.

### pc / integrity

```
pc = everyOtherChar( squeeze( hmacMd5( json(events), uuid:tag:ft ) ) )
```

squeeze = digits pass, other chars become charcode % 10. all 3 key parts travel in the same request so it's corruption detection not anti-forgery. advisory.

### transport

endpoint rotates when blocked:

| role | candidates |
|---|---|
| primary | `collector-<appid>.px-cloud.net/api/v2/collector` |
| disguised | `/assets/js/bundle` (dresses up as a js fetch lol), `/b/s`, `/b/c`, `/px/<appid>/xhr` |
| alt hosts | `px-cdn.net`, `pxchk.net`, `botchk.net`, `px-client.net` |
| fallbacks | sendbeacon `/beacon`, img GET `/noCors?` (tag chars stripped first) |

the capture below posts to `/assets/js/bundle`. it's a sensor request in a trenchcoat.

## server -> client

responses carry `opcode|arg|...` commands (or a `do`/`ob` json envelope). ~28 opcodes: bake cookie, set vid, feature flags, challenge params (xor10), config writes, script injection. two spicy ones:

- `ooIooI` — eval() server-supplied js in page origin, result posted back w/ next sensor. rce by design, no sig on pushed code
- `oIIoIIIo` — inject `<script src=...>` into document.head

trust boundary = whoever answers for the collector hostname. nice.

## checked against real traffic

`captured_body.txt` = sensor post from walmart.com (ff 158, seq=5, rsc=5, goes to the disguised bundle path). `decode_captured.js` on it:

| check | result |
|---|---|
| en=NTA | ✅ atob -> "50" |
| key from sid tag | ✅ xor10(b64("1792254544149")) |
| key chars at computed positions | ✅ 12/19 exact (rest needs to be checked)
| body pure b64 after strip | ✅ 3027 chars zero junk |
| json decodes | ✅ real events |
| tag blob = session ts | ✅ via xu() |

the decoded event (tag `OkZNAH8qTzE=`): dom paths incl `#sign-in-widget` + `#px-captcha` (it logs the challenge widget itself lol), pointerdown/up pairs at (137, 72.8), hi-res ts 37761 -> 45369, `isTrusted: true`, `en-US`, 128-hex canvas/audio hash, plus one ~1.4kb binary field (`DhI5VEh4O2c=`) that doesn't exist in our sample build — newer build, probably the ssk extension. their custom serializer emits it raw, their custom parser eats it, v8 chokes. decoder salvages around it.

pc can't be re-verified byte-exact for that reason (needs the full serialized json incl binary field) but the formula's confirmed from the code (line 4615).

## repro the deobf

```bash
npm i js-beautify @babel/parser @babel/traverse @babel/generator @babel/types

node tools/deob2.js  main.min.js stage1.js     # base-91
node tools/deob3.js  stage1.js   stage2.js     # iife accessors
node tools/deob4.js  stage2.js   stage3.js     # code defender
node tools/deob5.js  stage3.js   stage4.js     # atob/rot13
node tools/deflat.js stage4.js                 # -> vm_cfg.txt
node tools/unflatten_patch.js stage4.js stage5.js
node tools/deob3.js  stage5.js   stage6.js     # strings unlocked by known pcs
node tools/deob5.js  stage6.js   stage7.js
node tools/dce.js    stage7.js   stage8.js
node tools/rename.js stage8.js   stage9.js
npx js-beautify --indent-size 2 -f stage9.js -o out/main.deobf.js
```

idempotent, rerun finds nothing new. deflat.js is the fun one, rest is mechanical.

## run the tests

```bash
node test_payload_crypto.js    # 31 asserts
node decode_captured.js captured_body.txt captured_response.txt
```

## tl;dr findings

- field ids are the real secret, the cipher is mechanical
- one flattening template for all 16 fns
- eval + script injection are first-class opcodes
- sensor posts hide as `/assets/js/bundle` fetches
- sid carries the key material in invisible unicode
- canvas blocking is itself a signal (sentinels instead of hashes)
- movementX=0 && movementY=0 w/ position change = synthetic event tell
- integrity checksum is advisory

## disclaimer

research/education. no px infra touched. don't be a jerk with it.
