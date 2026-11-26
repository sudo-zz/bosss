#!/usr/bin/env node
/**
 * 开发机局域网更新服务（供人事电脑一键「检查更新 → 下载安装」，免登 GitHub）
 *
 * 用法：
 *   npm run release:serve           # 先自动打包最新发行版，再启动局域网更新服务（默认端口 8788）
 *   npm run release:serve -- --no-pack --port 8788
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RELEASE_DIR = path.join(ROOT, 'release');

const args = process.argv.slice(2);
const noPack = args.includes('--no-pack');
let port = 8788;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--port' && args[i + 1]) port = Number.parseInt(args[++i], 10) || 8788;
  else if (args[i].startsWith('--port=')) port = Number.parseInt(args[i].slice(7), 10) || 8788;
}

if (!noPack || !existsSync(path.join(RELEASE_DIR, 'latest.json'))) {
  execFileSync(process.execPath, [path.join(HERE, 'pack-release.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function getLanIps() {
  const ips = [];
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal) ips.push(item.address);
    }
  }
  return ips;
}

const ALLOWED_EXT = new Set(['.json', '.gz', '.tgz', '.txt']);

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'latest.json';
  const fileName = path.basename(rel);
  if (fileName !== rel || !ALLOWED_EXT.has(path.extname(fileName))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const full = path.join(RELEASE_DIR, fileName);
  if (!existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(fileName);
  const contentType =
    ext === '.json'
      ? 'application/json; charset=utf-8'
      : ext === '.txt'
        ? 'text/plain; charset=utf-8'
        : 'application/gzip';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(readFileSync(full));
});

server.listen(port, '0.0.0.0', () => {
  const manifest = JSON.parse(readFileSync(path.join(RELEASE_DIR, 'latest.json'), 'utf8'));
  const ips = getLanIps();
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  招聘助手局域网更新服务已启动（当前版本：v${manifest.version}）`);
  for (const ip of ips) {
    console.log(`  局域网更新地址 : http://${ip}:${port}`);
  }
  console.log(`  本机测试地址   : http://127.0.0.1:${port}/latest.json`);
  console.log('  用法：在人事电脑工作台点右上角「检查更新」，填入上方局域网地址即可 2 秒更新。');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
