#!/usr/bin/env node
/**
 * Thin repo wrapper invoking the portable boss-safari-recruiter dashboard generator
 * with this workspace's job rubric and expert overrides.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDashboardBuild } from '../skills/boss-safari-recruiter/scripts/generate_dashboard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const HOME = process.env.HOME || '.';

const summary = runDashboardBuild({
  input: path.join(HOME, '.boss-cli/unread-inspect.json'),
  config: path.join(ROOT_DIR, 'dashboard/rubric.json'),
  jd: path.join(HOME, '.boss-cli/jd/ai应用开发工程师.md'),
  overrides: path.join(ROOT_DIR, 'dashboard/expert-overrides.json'),
  avatarsSrc: path.join(HOME, '.boss-cli/avatars'),
  outDir: path.join(ROOT_DIR, 'dashboard'),
  report: path.join(ROOT_DIR, 'shortlist-report.md'),
  tracker: path.join(HOME, '.boss-cli/tracker.json'),
  syncTracker: true,
  openSafari: false,
});

console.log(JSON.stringify(summary, null, 2));
