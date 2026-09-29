import { beforeEach, describe, it, expect } from 'vitest';
import {
  getSkillMetadata,
  listGlobalSkills,
  listSkills,
  saveSkillMetadata,
} from './skill-center-storage';
import { GLOBAL_SKILLS_PREFIX, CUSTOM_SKILL_MARKER, SKILLS_BUCKET } from './skill-center-types';

function makeClient(objects: Record<string, string>) {
  const prefixes = new Set<string>();
  for (const key of Object.keys(objects)) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      prefixes.add(`${parts.slice(0, i).join('/')}/`);
    }
  }
  const streamEmitter = (events: string[]) => {
    let idx = 0;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            const val = events[idx++];
            return { done: !val, value: val ? { name: val } : undefined };
          },
        };
      },
      on: () => undefined,
    };
  };
  const emitter = (events: string[]) => {
    let idx = 0;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            const val = events[idx++];
            return { done: !val, value: val ? { prefix: val, size: 0 } : undefined };
          },
        };
      },
      on: () => undefined,
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

describe('bucket prefix and metadata lifecycle', () => {
  function makeEventClient(objects: Record<string, string>) {
    return {
      getObject: async (_bucket: string, key: string) => {
        const content = objects[key];
        if (content === undefined) throw new Error('Not found');
        return {
          on: (event: string, cb: (_chunk: Buffer) => void) => {
            if (event === 'data') cb(Buffer.from(content));
            if (event === 'end') cb(Buffer.alloc(0));
          },
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              next: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return { done: false, value: Buffer.from(content) };
              },
            };
          },
        };
      },
      putObject: async (
        bucket: string,
        key: string,
        data: Buffer,
        _size?: number,
        meta?: Record<string, string>,
      ) => {
        objects[key] = data.toString('utf-8');
        putCalls.push({ bucket, key, meta });
      },
      bucketExists: async () => true,
      makeBucket: async () => undefined,
      listObjects: () => {
        throw new Error('not used in this suite');
      },
    };
  }
  const putCalls: Array<{ bucket: string; key: string; meta?: Record<string, string> }> = [];

  beforeEach(() => {
    putCalls.length = 0;
  });

  it('writes metadata under the canonical bucket and skills/ metadata prefix', async () => {
    const client = makeEventClient({});
    await saveSkillMetadata(client, {
      name: 'coord',
      description: '协调',
      source: 'custom',
      createdAt: '2026-09-29T00:00:00.000Z',
      updatedAt: '2026-09-29T00:00:00.000Z',
      fileCount: 1,
    });
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].bucket).toBe(SKILLS_BUCKET);
    expect(putCalls[0].key).toBe('skills/coord.json');
    expect(putCalls[0].meta).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('round-trips metadata through get/save', async () => {
    const entry = {
      name: 'monitor',
      description: '监控',
      source: 'builtin' as const,
      createdAt: '2026-09-29T00:00:00.000Z',
      updatedAt: '2026-09-29T00:00:00.000Z',
      fileCount: 2,
    };
    const client = makeEventClient({});
    await saveSkillMetadata(client, entry);
    const key = `skills/${entry.name}.json`;
    const loaded = makeEventClient({ [key]: JSON.stringify(entry) });
    const result = await getSkillMetadata(loaded, entry.name);
    expect(result).toMatchObject({ name: 'monitor', description: '监控', source: 'builtin' });
  });

  it('getSkillMetadata returns null for missing or corrupt objects', async () => {
    const missing = makeEventClient({});
    expect(await getSkillMetadata(missing, 'ghost')).toBeNull();
    const corrupt = makeEventClient({ 'skills/broken.json': 'not json {' });
    expect(await getSkillMetadata(corrupt, 'broken')).toBeNull();
  });

  it('listSkills keeps only valid names under the metadata prefix', async () => {
    const entry = (name: string) =>
      JSON.stringify({
        name,
        description: name,
        source: 'custom',
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
      });
    const objects: Record<string, string> = {
      'skills/beta.json': entry('beta'),
      'skills/alpha.json': entry('alpha'),
      'skills/../escape.json': entry('escape'),
      'skills/not-json.txt': 'x',
      'skills/other/ignored.json': entry('ignored'),
    };
    const client = {
      listObjects: (_bucket: string, _prefix: string, _recursive: boolean) => ({
        [Symbol.asyncIterator]() {
          const names = Object.keys(objects);
          let idx = 0;
          return {
            next: async () => {
              if (idx < names.length) {
                idx += 1;
                return { done: false, value: { name: names[idx - 1] } };
              }
              return { done: true, value: undefined };
            },
          };
        },
      }),
      getObject: async (_bucket: string, key: string) => {
        const content = objects[key];
        if (content === undefined) throw new Error('Not found');
        return {
          on: (event: string, cb: (_chunk: Buffer) => void) => {
            if (event === 'data') cb(Buffer.from(content));
            if (event === 'end') cb(Buffer.alloc(0));
          },
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              next: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return { done: false, value: Buffer.from(content) };
              },
            };
          },
        };
      },
    };
    const skills = await listSkills(client);
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'beta']);
  });
});
