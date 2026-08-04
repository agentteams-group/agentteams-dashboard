import { describe, it, expect } from 'vitest';
import { listGlobalSkills } from './skill-center-storage';
import { GLOBAL_SKILLS_PREFIX, CUSTOM_SKILL_MARKER } from './skill-center-types';

function makeClient(objects: Record<string, string>) {
  const prefixes = new Set<string>();
  for (const key of Object.keys(objects)) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      prefixes.add(`${parts.slice(0, i).join('/')}/`);
    }
  }
  const emitter = (events: string[]) => {
    let idx = 0;
    let done = false;
    return {
      on: (event: string, cb: (_arg: unknown) => void) => {
        if (event === 'data') {
          while (idx < events.length) {
            cb({ prefix: events[idx] });
            idx += 1;
          }
        }
        if (event === 'end' && !done) {
          done = true;
          setTimeout(() => cb(null), 0);
        }
        return undefined;
      },
    };
  };
  const streamEmitter = (events: string[]) => {
    let idx = 0;
    let done = false;
    return {
      on: (event: string, cb: (_arg: unknown) => void) => {
        if (event === 'data') {
          while (idx < events.length) {
            cb({ objectName: events[idx] });
            idx += 1;
          }
        }
        if (event === 'end' && !done) {
          done = true;
          setTimeout(() => cb(null), 0);
        }
        return undefined;
      },
    };
  };
  return {
    listObjects: (_bucket: string, prefix: string, recursive: boolean) => {
      if (recursive) {
        return streamEmitter(Object.keys(objects).filter((k) => k.startsWith(prefix)));
      }
      return emitter(Array.from(prefixes).filter((p) => p.startsWith(prefix)));
    },
    getObject: async (_bucket: string, key: string) => {
      const content = objects[key];
      if (content === undefined) throw new Error('Not found');
      let yielded = false;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => {
              if (!yielded) {
                yielded = true;
                return Promise.resolve({ value: Buffer.from(content), done: false });
              }
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
        resume: () => undefined,
      };
    },
  };
}

describe('listGlobalSkills', () => {
  it('returns builtin skills from the global prefix', async () => {
    const client = makeClient({
      [`${GLOBAL_SKILLS_PREFIX}coord/SKILL.md`]: '---\nname: coord\ndescription: 协调\n---\n',
      [`${GLOBAL_SKILLS_PREFIX}coord/run.sh`]: '#!/bin/sh\n',
      [`${GLOBAL_SKILLS_PREFIX}monitor/SKILL.md`]: '---\nname: monitor\ndescription: 监控\n---\n',
      'agents/w1/skills/coord/SKILL.md': 'x',
    });
    const skills = await listGlobalSkills(client, 'agentteams-fs');
    expect(skills).toHaveLength(2);
    const coord = skills.find((s) => s.name === 'coord');
    expect(coord?.source).toBe('builtin');
    expect(coord?.description).toBe('协调');
    expect(coord?.fileCount).toBe(2);
  });

  it('tags skills with the custom marker as custom', async () => {
    const client = makeClient({
      [`${GLOBAL_SKILLS_PREFIX}uploaded/SKILL.md`]: '---\nname: uploaded\ndescription: 用户上传\n---\n',
      [`${GLOBAL_SKILLS_PREFIX}uploaded/${CUSTOM_SKILL_MARKER}`]: '',
    });
    const skills = await listGlobalSkills(client, 'agentteams-fs');
    const uploaded = skills.find((s) => s.name === 'uploaded');
    expect(uploaded?.source).toBe('custom');
  });

  it('skips invalid skill names', async () => {
    const client = makeClient({
      [`${GLOBAL_SKILLS_PREFIX}../evil/SKILL.md`]: 'x',
    });
    const skills = await listGlobalSkills(client, 'agentteams-fs');
    expect(skills).toHaveLength(0);
  });
});
