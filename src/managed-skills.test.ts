import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readManagedSkills,
  writeManagedSkills,
  addDisabledSkill,
  removeDisabledSkill,
  getDisabledSkill,
  getAllDisabledSkills,
  addSkillToGroup,
  removeSkillFromGroup,
  removeSkillFromAllGroups,
  getGroup,
  getAllGroups,
} from './managed-skills.ts';

const AGENTS_DIR = '.agents';
const MANAGED_FILE = 'managed-skills.json';

describe('managed-skills', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `managed-skills-test-${Date.now()}`);
    mkdirSync(join(testDir, AGENTS_DIR), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('read/write', () => {
    it('returns empty state when file does not exist', async () => {
      const data = await readManagedSkills('project', testDir);
      expect(data.version).toBe(1);
      expect(data.disabled).toEqual({});
      expect(data.groups).toEqual({});
    });

    it('writes and reads data correctly', async () => {
      const data = {
        version: 1,
        disabled: { 'my-skill': { source: 'owner/repo', sourceType: 'github' } },
        groups: { engineering: ['my-skill'] },
      };
      await writeManagedSkills(data, 'project', testDir);

      const filePath = join(testDir, AGENTS_DIR, MANAGED_FILE);
      expect(existsSync(filePath)).toBe(true);

      const read = await readManagedSkills('project', testDir);
      expect(read.disabled['my-skill']?.source).toBe('owner/repo');
      expect(read.groups['engineering']).toEqual(['my-skill']);
    });

    it('handles global scope path', async () => {
      const data = {
        version: 1,
        disabled: {},
        groups: { test: ['foo'] },
      };
      await writeManagedSkills(data, 'global');

      const read = await readManagedSkills('global');
      expect(read.groups['test']).toEqual(['foo']);
    });
  });

  describe('disabled skills CRUD', () => {
    it('adds a disabled skill', async () => {
      await addDisabledSkill(
        'my-skill',
        { source: 'owner/repo', sourceType: 'github' },
        'project',
        testDir
      );
      const entry = await getDisabledSkill('my-skill', 'project', testDir);
      expect(entry).not.toBeNull();
      expect(entry!.source).toBe('owner/repo');
    });

    it('removes a disabled skill', async () => {
      await addDisabledSkill(
        'my-skill',
        { source: 'owner/repo', sourceType: 'github' },
        'project',
        testDir
      );
      const removed = await removeDisabledSkill('my-skill', 'project', testDir);
      expect(removed).toBe(true);
      const entry = await getDisabledSkill('my-skill', 'project', testDir);
      expect(entry).toBeNull();
    });

    it('returns false when removing non-existent skill', async () => {
      const removed = await removeDisabledSkill('nonexistent', 'project', testDir);
      expect(removed).toBe(false);
    });

    it('overwrites existing entry with same name', async () => {
      await addDisabledSkill(
        'my-skill',
        { source: 'old/repo', sourceType: 'github' },
        'project',
        testDir
      );
      await addDisabledSkill(
        'my-skill',
        { source: 'new/repo', sourceType: 'github' },
        'project',
        testDir
      );
      const entry = await getDisabledSkill('my-skill', 'project', testDir);
      expect(entry!.source).toBe('new/repo');
    });

    it('lists all disabled skills', async () => {
      await addDisabledSkill('a', { source: 'a/repo', sourceType: 'github' }, 'project', testDir);
      await addDisabledSkill('b', { source: 'b/repo', sourceType: 'github' }, 'project', testDir);
      const all = await getAllDisabledSkills('project', testDir);
      expect(Object.keys(all).sort()).toEqual(['a', 'b']);
    });
  });

  describe('groups CRUD', () => {
    it('adds a skill to a group', async () => {
      await addSkillToGroup('engineering', 'grill-with-docs', 'project', testDir);
      const members = await getGroup('engineering', 'project', testDir);
      expect(members).toEqual(['grill-with-docs']);
    });

    it('does not add duplicates to a group', async () => {
      await addSkillToGroup('engineering', 'grill-with-docs', 'project', testDir);
      await addSkillToGroup('engineering', 'grill-with-docs', 'project', testDir);
      const members = await getGroup('engineering', 'project', testDir);
      expect(members).toEqual(['grill-with-docs']);
    });

    it('removes a skill from a group', async () => {
      await addSkillToGroup('engineering', 'grill-with-docs', 'project', testDir);
      await addSkillToGroup('engineering', 'pr-review', 'project', testDir);
      await removeSkillFromGroup('engineering', 'grill-with-docs', 'project', testDir);
      const members = await getGroup('engineering', 'project', testDir);
      expect(members).toEqual(['pr-review']);
    });

    it('deletes group when last skill is removed', async () => {
      await addSkillToGroup('engineering', 'grill-with-docs', 'project', testDir);
      await removeSkillFromGroup('engineering', 'grill-with-docs', 'project', testDir);
      const members = await getGroup('engineering', 'project', testDir);
      expect(members).toBeNull();
    });

    it('removes skill from all groups', async () => {
      await addSkillToGroup('frontend', 'react', 'project', testDir);
      await addSkillToGroup('backend', 'react', 'project', testDir);
      await removeSkillFromAllGroups('react', 'project', testDir);
      const frontend = await getGroup('frontend', 'project', testDir);
      const backend = await getGroup('backend', 'project', testDir);
      expect(frontend).toBeNull();
      // backend group should be deleted too since react was its only member
      if (backend) {
        expect(backend).not.toContain('react');
      }
    });

    it('lists all groups', async () => {
      await addSkillToGroup('a', 'skill1', 'project', testDir);
      await addSkillToGroup('b', 'skill2', 'project', testDir);
      const all = await getAllGroups('project', testDir);
      expect(Object.keys(all).sort()).toEqual(['a', 'b']);
    });
  });
});
