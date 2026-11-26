import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill';

const PROVIDER_NAME = 'boss-safari-recruiter';
const SKILL_BODY_URL = new URL('../assets/boss-safari-recruiter/SKILL.md', import.meta.url);
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/boss-safari-recruiter/', import.meta.url)),
};

const CANDIDATE = {
  name: 'boss-safari-recruiter',
  description:
    'End-to-end Boss Zhipin AI recruiting workflow via host macOS Safari (boss_* tools). Use when checking Safari/Boss readiness, reading JDs, screening unread chats or recommended candidates, scoring candidates, updating the local tracker, or running approval-gated outreach.',
  invocation: {
    modelInvocable: true,
    userInvocable: true,
  },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
};

const provider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate) {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    };
  },
};

export const name = 'boss-recruiter-skill';
export const inject = ['skills'];

export function apply(ctx) {
  ctx.skills.registerProvider(() => provider);
}
