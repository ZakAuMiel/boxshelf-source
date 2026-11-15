// (fork) Streaming shelf: games from another PC, played through Moonlight (moonlight-qt) from a Sunshine or GeForce
// Experience host. Boxshelf never streams anything itself: it asks Moonlight's command line for the host's app list
// (`moonlight list <host> --csv`), shows each app as a box on a "Streaming" shelf, and starts one with
// `moonlight stream <host> "<app>"`. Moonlight runs like any other program Boxshelf starts (launcher.launchApp), so the
// launch slide, the quit combo and the Home menu work the same; closing it ends the stream.
// The host must already be paired in Moonlight (its own window, once). An optional MAC address wakes the host first
// (Wake-on-LAN magic packet, UDP broadcast on port 9).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const { execFile } = require('child_process');
const { fileURLToPath } = require('url');
const { isFile } = require('./paths');

const FLATPAK_ID = 'com.moonlight_stream.Moonlight';
let log = () => {};
function init(o = {}) { if (o.log) log = o.log; }

// ---------- finding Moonlight ----------
function onPath(names, env = process.env) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); if (isFile(f)) return f; }
  return '';
}
// where Moonlight usually is: its installer's folder (Windows); a package, the Flatpak's exported launcher or an
// AppImage in ~/Applications (Linux); the app bundle (macOS). '' when none is found
function find(o = {}) {
  const plat = o.platform || process.platform, env = o.env || process.env, home = o.home || env.HOME || os.homedir();
  if (plat === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    for (const r of roots) { const f = path.join(r, 'Moonlight Game Streaming', 'Moonlight.exe'); if (isFile(f)) return f; }
    return onPath(['Moonlight.exe'], env);
  }
  if (plat === 'darwin') { const f = '/Applications/Moonlight.app/Contents/MacOS/Moonlight'; return isFile(f) ? f : ''; }
  const pkg = onPath(['moonlight', 'moonlight-qt'], env); if (pkg) return pkg;
  for (const f of [path.join(home, '.local/share/flatpak/exports/bin', FLATPAK_ID), path.join('/var/lib/flatpak/exports/bin', FLATPAK_ID)]) if (isFile(f)) return f;
  for (const d of [path.join(home, 'Applications'), path.join(home, '.local/bin'), path.join(home, 'Downloads')]) {
    let names = []; try { names = fs.readdirSync(d); } catch {}
    const n = names.find(x => /^moonlight.*\.appimage$/i.test(x)); if (n && isFile(path.join(d, n))) return path.join(d, n);
  }
  return '';
}

// ---------- the host's apps ----------
// `moonlight list <host> --csv`: a header line, then  "Name",ID,hdr,collector,hidden,directLaunch,"Boxart URL"
// Moonlight doesn't escape quotes inside a name, so each line is read from both ends
const ROW = /^"(.*)",(-?\d+),(true|false),(true|false),(true|false),(true|false),"(.*)"\s*$/;
function parseCsv(text) {
  const out = [], seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = ROW.exec(line.trim()); if (!m) continue;
    const name = m[1].trim(); if (!name || seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
    out.push({ name, id: Number(m[2]), hidden: m[5] === 'true', boxart: m[7] || '' });
  }
  return out;
}
// Moonlight's cached box art is a file:// address: a plain path when the file is there, else ''
function boxartFile(url) {
  if (!url || !/^file:/i.test(url)) return '';
  try { const f = fileURLToPath(url); return isFile(f) ? f : ''; } catch { return ''; }
}
function list({ exe, host, timeoutMs = 20000, env } = {}) {
  return new Promise((resolve, reject) => {
    if (!exe || !isFile(exe)) return reject(new Error("Can't find Moonlight. Install it, or choose Moonlight.exe / moonlight in Settings → Streaming."));
    if (!host) return reject(new Error('Choose your host PC (its name or IP address) in Settings → Streaming.'));
    execFile(exe, ['list', String(host), '--csv'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 << 20, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      const apps = parseCsv(stdout);
      if (apps.length) return resolve(apps); // (a non-zero exit after a full list still counts)
      const why = String(stderr || '').trim().split(/\r?\n/).pop() || (err && (err.killed ? 'no answer from the host' : err.message)) || 'no apps';
      reject(new Error(/not been paired/i.test(why) ? `${host} isn't paired yet: open Moonlight once, add it and pair it, then refresh.` : `Couldn't get the games from ${host}: ${why}`));
    });
  });
}

// ---------- shelf entries ----------
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'app';
// Sunshine's own entries that aren't games stay off the shelf (the desktop itself, Steam Big Picture is kept)
const NOT_GAMES = /^(desktop|remote desktop|terminate|virtual desktop)$/i;
const q = s => '"' + String(s).replace(/"/g, '') + '"';
// the arguments after the Moonlight program: a stream of one app, fullscreen, with the settings chosen
function streamArgs(c, appName) {
  const a = ['stream', q(c.host), q(appName), '--display-mode', 'fullscreen'];
  if (/^\d{3,5}x\d{3,5}$/.test(c.resolution || '')) a.push('--resolution', c.resolution);
  if (c.fps > 0) a.push('--fps', String(c.fps));
  if (c.bitrate > 0) a.push('--bitrate', String(c.bitrate));
  if (c.quitAfter) a.push('--quit-after');
  return a.join(' ');
}
// the cached app list as games for the shelf: { id, source: 'moonlight', title, exe, args, cover, appId }
// exe: the Flatpak's launcher works as is (it's a script that runs `flatpak run`)
function games(c) {
  if (!c || !c.enabled || !c.host || !c.path || !isFile(c.path)) return [];
  return (Array.isArray(c.apps) ? c.apps : []).filter(a => a && a.name && !a.hidden && !a.name.includes('"') && !NOT_GAMES.test(a.name.trim())).slice(0, 500)
    .map(a => ({ id: 'moonlight-' + slug(a.name), source: 'moonlight', title: a.name.trim().slice(0, 120), exe: c.path, args: streamArgs(c, a.name), cover: boxartFile(a.boxart), appId: a.id }));
}

// ---------- Wake-on-LAN ----------
// "AA:BB:CC:DD:EE:FF" or "AA-BB-..." or "AABBCCDDEEFF" → 6 bytes, else null
function macBytes(mac) {
  const h = String(mac || '').replace(/[^0-9a-f]/gi, '');
  return h.length === 12 ? Buffer.from(h, 'hex') : null;
}
function magicPacket(mac) {
  const m = macBytes(mac); if (!m) return null;
  const p = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) m.copy(p, 6 + i * 6);
  return p;
}
// sends the packet a few times (a sleeping network card can miss one); resolves true when sent, false on a bad MAC
function wake(mac, { address = '255.255.255.255', port = 9, times = 3 } = {}) {
  const p = magicPacket(mac); if (!p) return Promise.resolve(false);
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4'); let left = times, done = false;
    const end = ok => { if (done) return; done = true; try { s.close(); } catch {} resolve(ok); };
    s.on('error', e => { log('Moonlight: wake-on-LAN failed', e.message); end(false); });
    s.bind(() => { try { s.setBroadcast(true); } catch {}
      const send = () => s.send(p, port, address, err => { if (err) { log('Moonlight: wake-on-LAN failed', err.message); return end(false); } if (--left > 0) setTimeout(send, 100); else end(true); });
      send(); });
  });
}

module.exports = { init, find, parseCsv, boxartFile, list, streamArgs, games, macBytes, magicPacket, wake, FLATPAK_ID };
