#!/usr/bin/env node
/**
 * Portable workspace project scanner for Agent recruitment alignment.
 * Inspects local repositories to extract active tech stacks, AI frameworks,
 * coding tools, and business domains so agents can build tailored rubrics.
 */
import fs from 'node:fs';
import path from 'node:path';

const TECH_PATTERNS = [
  { tag: 'Java', re: /\bjava\b|spring\s*boot|spring\s*cloud|spring\s*ai|mybatis|pom\.xml/i },
  { tag: 'Python', re: /\bpython\b|fastapi|django|flask|pyproject\.toml|uv\b/i },
  { tag: 'TypeScript/React', re: /\btypescript\b|\breact\b|next\.?js|electron|vite|ant\s*design|shadcn/i },
  { tag: 'Vue', re: /\bvue\b|nuxt|element-plus|pinia/i },
  { tag: 'Go', re: /\bgolang\b|\bgo\s+1\.|go\.mod|gin\b|pgx\b/i },
  { tag: 'LangGraph/Agent', re: /langgraph|pi\s+durable|openclaw|hermes|autogen|crewai|multi-?agent|agentic/i },
  { tag: 'MCP/Skills', re: /\bmcp\b|fastmcp|tool\s*calling|function\s*calling|\bskills?\b/i },
  { tag: 'RAG/Vector', re: /\brag\b|pgvector|milvus|qdrant|lightrag|graphrag|rerank|embedding|hybrid/i },
  { tag: 'Multimodal/OCR/ASR', re: /mineru|funasr|whisper|ocr|qwen-?vl|tts|asr|多模态/i },
  { tag: 'PostgreSQL/Redis/MQ', re: /postgres|pgvector|\bmysql\b|redis|kafka|rabbitmq|docker|minio|s3/i },
  { tag: 'AI Coding Harness', re: /codex|claude\s*code|workbuddy|cursor|openclaw|harness|hitl/i },
  { tag: 'B2B/IM/Workflow', re: /crm|erp|wiki|rbac|rls|acl|多租户|审批|飞书|lark|企业微信|wecom|工作流/i },
];

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '.venv', '__pycache__', '.boss-sessions']);
const DOC_CANDIDATES = ['proj.md', 'AGENTS.md', 'README.md', 'README_zh.md', 'docs/技术栈与实现说明.md'];
const MANIFEST_CANDIDATES = ['package.json', 'pom.xml', 'go.mod', 'pyproject.toml', 'requirements.txt'];

function parseArgs(argv) {
  const args = {
    dir: path.resolve(process.env.HOME || '.', 'Documents/work'),
    maxProjects: 20,
    json: false,
    out: '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) args.dir = path.resolve(argv[++i]);
    else if (a === '--max-projects' && argv[i + 1]) args.maxProjects = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (a === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scan_projects.mjs [--dir <workspace-root>] [--max-projects 20] [--json] [--out <file>]');
      process.exit(0);
    }
  }
  return args;
}

function readHead(filePath, maxChars = 4000) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return '';
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars);
  } catch {
    return '';
  }
}

function extractSummary(docTexts) {
  for (const text of docTexts) {
    if (!text) continue;
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('```') && !l.startsWith('---') && !l.startsWith('<'));
    const meaningful = lines.filter((l) => !l.startsWith('#') && l.length >= 12);
    if (meaningful.length > 0) return meaningful.slice(0, 2).join(' ').slice(0, 220);
  }
  return '';
}

function isProjectDir(dirPath) {
  return [...DOC_CANDIDATES, ...MANIFEST_CANDIDATES, '.git'].some((name) =>
    fs.existsSync(path.join(dirPath, name)),
  );
}

function scanProject(projDir) {
  const name = path.basename(projDir);
  const docs = DOC_CANDIDATES.map((rel) => ({ rel, text: readHead(path.join(projDir, rel), 4500) })).filter((d) => d.text);
  const manifests = MANIFEST_CANDIDATES.map((rel) => ({ rel, text: readHead(path.join(projDir, rel), 2500) })).filter((m) => m.text);
  const corpus = [...docs, ...manifests].map((x) => `${x.rel}\n${x.text}`).join('\n');
  if (!corpus.trim()) return null;

  const techTags = TECH_PATTERNS.filter((p) => p.re.test(corpus)).map((p) => p.tag);
  return {
    name,
    path: projDir,
    filesRead: [...docs.map((d) => d.rel), ...manifests.map((m) => m.rel)],
    techTags,
    summary: extractSummary(docs.map((d) => d.text)),
  };
}

function discoverProjectDirs(rootDir, maxProjects) {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  if (isProjectDir(rootDir) && !fs.readdirSync(rootDir, { withFileTypes: true }).some((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name) && isProjectDir(path.join(rootDir, e.name)))) {
    return [rootDir];
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(rootDir, entry.name);
    if (isProjectDir(full)) dirs.push(full);
    if (dirs.length >= maxProjects) break;
  }
  return dirs.length > 0 ? dirs : isProjectDir(rootDir) ? [rootDir] : [];
}

function main() {
  const args = parseArgs(process.argv);
  const projectDirs = discoverProjectDirs(args.dir, args.maxProjects);
  const projects = projectDirs.map(scanProject).filter(Boolean);

  const tagCounts = {};
  for (const p of projects) {
    for (const tag of p.techTags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  const topTechSignals = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));

  const result = {
    scannedRoot: args.dir,
    scannedAt: new Date().toISOString(),
    projectCount: projects.length,
    topTechSignals,
    projects,
  };

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n', 'utf8');
  }

  if (args.json || !args.out) {
    console.log(JSON.stringify(result, null, 2));
  }
}

main();
