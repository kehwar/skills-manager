import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const AGENTS_DIR = '.agents';
const MANAGED_FILE = 'managed-skills.json';
const CURRENT_VERSION = 1;

export interface ManagedSkillEntry {
  source: string;
  sourceType: string;
  sourceUrl?: string;
  skillPath?: string;
  ref?: string;
  /** Groups the skill belonged to when it was disabled */
  groups?: string[];
}

export interface ManagedSkillsFile {
  version: number;
  disabled: Record<string, ManagedSkillEntry>;
  groups: Record<string, string[]>;
}

function getManagedPath(scope: 'global' | 'project', cwd?: string): string {
  if (scope === 'global') {
    return join(homedir(), AGENTS_DIR, MANAGED_FILE);
  }
  return join(cwd || process.cwd(), AGENTS_DIR, MANAGED_FILE);
}

function createEmpty(): ManagedSkillsFile {
  return { version: CURRENT_VERSION, disabled: {}, groups: {} };
}

export async function readManagedSkills(
  scope: 'global' | 'project',
  cwd?: string
): Promise<ManagedSkillsFile> {
  const filePath = getManagedPath(scope, cwd);
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as ManagedSkillsFile;
    if (typeof parsed.version !== 'number') return createEmpty();
    if (parsed.version < CURRENT_VERSION) return createEmpty();
    return {
      version: parsed.version,
      disabled: parsed.disabled || {},
      groups: parsed.groups || {},
    };
  } catch {
    return createEmpty();
  }
}

export async function writeManagedSkills(
  data: ManagedSkillsFile,
  scope: 'global' | 'project',
  cwd?: string
): Promise<void> {
  const filePath = getManagedPath(scope, cwd);
  await mkdir(dirname(filePath), { recursive: true });
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');
}

export async function addDisabledSkill(
  skillName: string,
  entry: ManagedSkillEntry,
  scope: 'global' | 'project',
  cwd?: string
): Promise<void> {
  const data = await readManagedSkills(scope, cwd);
  data.disabled[skillName] = entry;
  await writeManagedSkills(data, scope, cwd);
}

export async function removeDisabledSkill(
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<boolean> {
  const data = await readManagedSkills(scope, cwd);
  if (!(skillName in data.disabled)) return false;
  delete data.disabled[skillName];
  await writeManagedSkills(data, scope, cwd);
  return true;
}

export async function getDisabledSkill(
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<ManagedSkillEntry | null> {
  const data = await readManagedSkills(scope, cwd);
  return data.disabled[skillName] ?? null;
}

export async function getAllDisabledSkills(
  scope: 'global' | 'project',
  cwd?: string
): Promise<Record<string, ManagedSkillEntry>> {
  const data = await readManagedSkills(scope, cwd);
  return { ...data.disabled };
}

export async function addSkillToGroup(
  groupName: string,
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<void> {
  const data = await readManagedSkills(scope, cwd);
  if (!data.groups[groupName]) {
    data.groups[groupName] = [];
  }
  if (!data.groups[groupName].includes(skillName)) {
    data.groups[groupName].push(skillName);
  }
  await writeManagedSkills(data, scope, cwd);
}

export async function removeSkillFromGroup(
  groupName: string,
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<void> {
  const data = await readManagedSkills(scope, cwd);
  if (!data.groups[groupName]) return;
  data.groups[groupName] = data.groups[groupName].filter((s) => s !== skillName);
  if (data.groups[groupName].length === 0) {
    delete data.groups[groupName];
  }
  await writeManagedSkills(data, scope, cwd);
}

export async function removeSkillFromAllGroups(
  skillName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<void> {
  const data = await readManagedSkills(scope, cwd);
  for (const groupName of Object.keys(data.groups)) {
    const group = data.groups[groupName];
    if (!group) continue;
    data.groups[groupName] = group.filter((s) => s !== skillName);
    if (data.groups[groupName].length === 0) {
      delete data.groups[groupName];
    }
  }
  await writeManagedSkills(data, scope, cwd);
}

export async function getGroup(
  groupName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<string[] | null> {
  const data = await readManagedSkills(scope, cwd);
  return data.groups[groupName] ?? null;
}

export async function getAllGroups(
  scope: 'global' | 'project',
  cwd?: string
): Promise<Record<string, string[]>> {
  const data = await readManagedSkills(scope, cwd);
  return { ...data.groups };
}
