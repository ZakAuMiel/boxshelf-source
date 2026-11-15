// (fork) Streaming shelf test (plain Node, on Linux): a pretend Moonlight in a made-up home folder answers `list --csv`,
// and the shelf entries, their stream arguments, the settings clean-up and the wake-on-LAN packet are checked.
// Exit code 1 = something's wrong.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
if (process.platform !== 'linux') { console.log('Linux only: skipped'); process.exit(0); }

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'bxml-'));
const mk = (p, body, exec) => { const f = path.join(HOME, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body || ''); if (exec) fs.chmodSync(f, 0o755); return f; };
const art = mk('.cache/Moonlight/boxart/1234.png', 'png');
const csv = [
  'Name, ID, HDR Support, App Collection Game, Hidden, Direct Launch, Boxart URL',
  `"Desktop",1,false,false,false,false,""`,
  `"Elden Ring, Deluxe",2,true,false,false,false,"file://${art}"`,
  `"Hidden Game",3,false,false,true,false,""`,
  `"Yuzu ""Test""",4,false,false,false,false,""`,
  `"Steam Big Picture",5,false,false,false,false,"file:///nope.png"`,
].join('\n');
const flatpak = mk('.local/share/flatpak/exports/bin/com.moonlight_stream.Moonlight',
  `#!/bin/sh\nif [ "$1" = list ] && [ "$2" = mypc ]; then cat <<'EOF'\n${csv}\nEOF\nexit 0; fi\nif [ "$1" = list ]; then echo "Computer x has not been paired. Please open Moonlight to pair" >&2; exit 255; fi\nexit 0\n`, true);

const root = path.resolve(__dirname, '..', '..');
const ml = require(path.join(root, 'main', 'moonlight.js'));
const config = require(path.join(root, 'main', 'config.js'));
const { buildArgs } = (() => { try { return require(path.join(root, 'main', 'launcher.js')); } catch { // (outside Electron: just the argument splitter)
  const src = fs.readFileSync(path.join(root, 'main', 'launcher.js'), 'utf8'), m = /function buildArgs[\s\S]*?\n}\n/.exec(src);
  return { buildArgs: new Function('path', m[0] + 'return buildArgs;')(path) }; } })();

let fails = 0; const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  -> ' + detail)); if (!ok) fails++; };

(async () => {
  const found = ml.find({ platform: 'linux', env: { PATH: '/nonexistent' }, home: HOME });
  check('finds the Flatpak launcher', found === flatpak, found);
  check('nothing found in an empty home', ml.find({ platform: 'linux', env: { PATH: '/nonexistent' }, home: path.join(HOME, 'none') }) === '', 'found something');

  const apps = ml.parseCsv(csv);
  check('reads every app row', apps.length === 5, JSON.stringify(apps));
  check('a comma inside a name', apps[1] && apps[1].name === 'Elden Ring, Deluxe', apps[1] && apps[1].name);
  check('hidden flag', apps[2] && apps[2].hidden === true, JSON.stringify(apps[2]));

  const listed = await ml.list({ exe: flatpak, host: 'mypc' });
  check('list through the program', listed.length === 5, listed.length);
  let msg = ''; try { await ml.list({ exe: flatpak, host: 'other' }); } catch (e) { msg = e.message; }
  check('an unpaired host says so', /isn't paired yet/.test(msg), msg);
  msg = ''; try { await ml.list({ exe: path.join(HOME, 'nope'), host: 'mypc' }); } catch (e) { msg = e.message; }
  check('a missing Moonlight says so', /Can't find Moonlight/.test(msg), msg);

  const cfg = config.normalize({ moonlight: { enabled: true, path: flatpak, host: 'mypc', mac: 'aa-bb-cc-dd-ee-ff', fps: 60, resolution: '1920x1080', quitAfter: true, apps: listed } }).moonlight;
  const games = ml.games(cfg);
  check('shelf: Desktop, hidden and quoted names left out', games.map(g => g.title).join('|') === 'Elden Ring, Deluxe|Steam Big Picture', games.map(g => g.title).join('|'));
  check('shelf: local box art used, a missing one dropped', games[0].cover === art && games[1].cover === '', JSON.stringify(games.map(g => g.cover)));
  check('shelf: ids are stable slugs', games[0].id === 'moonlight-elden-ring-deluxe', games[0].id);
  const argv = buildArgs(games[0].args, '');
  check('stream arguments', JSON.stringify(argv) === JSON.stringify(['stream', 'mypc', 'Elden Ring, Deluxe', '--display-mode', 'fullscreen', '--resolution', '1920x1080', '--fps', '60', '--quit-after']), JSON.stringify(argv));
  check('off: no games', ml.games({ ...cfg, enabled: false }).length === 0, 'games while off');

  const bad = config.normalize({ moonlight: { enabled: 'yes', host: 'my "pc"', mac: 'zz', fps: 9999, resolution: '4k', apps: 'x' } }).moonlight;
  check('settings clean-up', bad.enabled === false && bad.host === 'my pc' && bad.mac === '' && bad.fps === 0 && bad.resolution === '' && Array.isArray(bad.apps), JSON.stringify(bad));

  const p = ml.magicPacket('AA:BB:CC:DD:EE:FF');
  check('magic packet: 6 x FF then 16 x the MAC', p && p.length === 102 && p.subarray(0, 6).every(b => b === 0xff) && p.subarray(96).toString('hex') === 'aabbccddeeff', p && p.toString('hex'));
  check('a bad MAC makes no packet', ml.magicPacket('12:34') === null, 'packet made');
  check('wake: sent to the loopback', await ml.wake('AA:BB:CC:DD:EE:FF', { address: '127.0.0.1', port: 40999, times: 1 }) === true, 'not sent');

  fs.rmSync(HOME, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'All passed');
  process.exit(fails ? 1 : 0);
})();
