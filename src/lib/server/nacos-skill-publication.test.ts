// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { publishDraft, resumePublication, type Publication } from './nacos-skill-publication';
import { packageDigest, publicationZip, type openNacosSkills } from './nacos-ard';

const zip = publicationZip('review', new Map([['SKILL.md', Buffer.from('---\nname: review\ndescription: A checklist\n---\n')]]), '1.0.0', {});
const record: Publication = { version: '1.0.0', base: '', digest: packageDigest(zip, 'review'), message: 'First release', source: '' };
type Nacos = Awaited<ReturnType<typeof openNacosSkills>>;
it('creates a first draft only for an absent resource and persists its identity before upload', async () => {
  const save = vi.fn(), createDraft = vi.fn();
  const nacos = { meta: vi.fn().mockResolvedValue(null), createDraft } as unknown as Nacos;
  await publishDraft(nacos, 'review', record, null, zip, save);
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(createDraft.mock.invocationCallOrder[0]);
  vi.mocked(nacos.meta).mockResolvedValue({ versions: [], labels: { latest: '2.0.0' } });
  await expect(publishDraft(nacos, 'review', record, null, zip, save)).rejects.toThrow('已存在');
  expect(createDraft).toHaveBeenCalledTimes(1);
});

it('resumes the same verified draft after submit failure and never submits an edited or foreign draft', async () => {
  let status = 'draft';
  const transition = vi.fn().mockRejectedValueOnce(new Error('Nacos 503')).mockImplementation(async () => { status = 'online'; });
  const nacos = { meta: async () => ({ editingVersion: status === 'draft' ? record.version : '', versions: [{ version: record.version, status }] }),
    versionDigest: vi.fn().mockResolvedValue(record.digest), transition } as unknown as Nacos;
  await expect(resumePublication(nacos, 'review', record)).rejects.toThrow('503');
  vi.mocked(nacos.versionDigest).mockResolvedValueOnce('other content');
  await expect(resumePublication(nacos, 'review', record)).rejects.toThrow('内容');
  expect(await resumePublication(nacos, 'review', record)).toBe('online');
  expect(await resumePublication(nacos, 'review', record)).toBe('online');
  vi.mocked(nacos.versionDigest).mockResolvedValueOnce('another online package');
  await expect(resumePublication(nacos, 'review', record)).rejects.toThrow('内容');
  expect(transition).toHaveBeenCalledTimes(2);
});
