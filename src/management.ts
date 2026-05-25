import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getSkillFromLock } from './skill-lock.ts';
import { getSkillFromLocalLock } from './local-lock.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { runAdd } from './add.ts';
import { listInstalledSkills } from './installer.ts';
import { agents } from './agents.ts';
import { detectAgent } from './detect-agent.ts';
import { readLocalLock } from './local-lock.ts';
import { getAllLockedSkills } from './skill-lock.ts';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

// --- Managed Skills Data Layer ---

const AGENTS_DIR = '.agents';
const MANAGED_FILE = 'managed-skills.json';
const CURRENT_VERSION = 1;

export interface ManagedSkillEntry {
  source: string;
  sourceType: string;
  sourceUrl?: string;
  skillPath?: string;
  ref?: string;
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

function parseScope(args: string[]): { global: boolean; rest: string[] } {
  const global = args.includes('-g') || args.includes('--global');
  const rest = args.filter((a) => a !== '-g' && a !== '--global');
  return { global, rest };
}

export async function runDisable(args: string[]): Promise<void> {
  const { global: isGlobal, rest } = parseScope(args);

  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — disabling non-interactively'
    );
  }

  const cwd = process.cwd();
  const scope = isGlobal ? 'global' : 'project';

  let skillNames: string[];

  // No skill name given: show interactive selection of installed skills
  if (rest.length === 0) {
    if (!process.stdin.isTTY) {
      p.log.error(pc.red('Missing skill name'));
      p.log.message(pc.dim('Usage: skills disable <skill-name> [-g]'));
      process.exit(1);
    }

    const installed = await listInstalledSkills({ global: isGlobal });
    const tracked = isGlobal ? await getAllLockedSkills() : (await readLocalLock(cwd)).skills;
    const alreadyDisabled = await getAllDisabledSkills(scope, cwd);

    const choices = installed
      .filter((s) => s.name in tracked && !(s.name in alreadyDisabled))
      .map((s) => ({ value: s.name, label: s.name }));

    if (choices.length === 0) {
      p.log.info(`${DIM}No installed skills to disable (${scope}).${RESET}`);
      process.exit(0);
    }

    const selected = await p.multiselect({
      message: `Select skills to disable ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Disable cancelled');
      process.exit(0);
    }

    skillNames = selected as string[];
  } else {
    skillNames = rest;
  }

  // Collect lock entries for all skills before removing
  const entries: Array<{
    name: string;
    source: string;
    sourceType: string;
    sourceUrl?: string;
    skillPath?: string;
    ref?: string;
    groups: string[];
  }> = [];

  const allGroups = await getAllGroups(scope, cwd);

  for (const name of skillNames) {
    const lockEntry = isGlobal
      ? await getSkillFromLock(name)
      : await getSkillFromLocalLock(name, cwd);

    if (!lockEntry) {
      p.log.error(pc.red(`Skill "${name}" is not installed — skipping.`));
      continue;
    }

    const skillGroups = Object.entries(allGroups)
      .filter(([, members]) => members.includes(name))
      .map(([g]) => g);

    entries.push({
      name,
      source: lockEntry.source,
      sourceType: lockEntry.sourceType,
      sourceUrl: 'sourceUrl' in lockEntry ? (lockEntry as any).sourceUrl : undefined,
      skillPath: lockEntry.skillPath,
      ref: lockEntry.ref,
      groups: skillGroups,
    });
  }

  if (entries.length === 0) {
    process.exit(1);
  }

  // Single removeCommand call for all skills
  await removeCommand(
    entries.map((e) => e.name),
    { global: isGlobal, yes: true }
  );

  // Write disabled entries and scrub groups
  for (const entry of entries) {
    await addDisabledSkill(
      entry.name,
      {
        source: entry.source,
        sourceType: entry.sourceType,
        sourceUrl: entry.sourceUrl,
        skillPath: entry.skillPath,
        ref: entry.ref,
        ...(entry.groups.length > 0 && { groups: entry.groups }),
      },
      scope,
      cwd
    );
    await removeSkillFromAllGroups(entry.name, scope, cwd);
    p.log.success(pc.green(`Disabled ${pc.cyan(entry.name)} (${scope})`));
  }

  console.log();
  p.outro(pc.green(`Disabled ${entries.length} skill(s)`));
}

async function enableOne(skillName: string, isGlobal: boolean): Promise<void> {
  const cwd = process.cwd();
  const scope = isGlobal ? 'global' : 'project';
  const scopeLabel = isGlobal ? 'global' : 'project';

  const entry = await getDisabledSkill(skillName, scope, cwd);

  if (!entry) {
    p.log.error(pc.red(`Skill "${skillName}" is not disabled.`));
    return;
  }

  const savedGroups = entry.groups || [];

  await runAdd([entry.source], {
    skill: [skillName],
    yes: true,
    global: isGlobal,
  });

  await removeDisabledSkill(skillName, scope, cwd);

  // Restore group membership
  for (const groupName of savedGroups) {
    await addSkillToGroup(groupName, skillName, scope, cwd);
  }

  p.log.success(pc.green(`Enabled ${pc.cyan(skillName)} (${scopeLabel})`));
}

export async function runEnable(args: string[]): Promise<void> {
  const { global: isGlobal, rest } = parseScope(args);

  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — enabling non-interactively'
    );
  }

  const cwd = process.cwd();
  const scope = isGlobal ? 'global' : 'project';

  // No skill name given: show interactive selection of disabled skills
  if (rest.length === 0) {
    if (!process.stdin.isTTY) {
      p.log.error(pc.red('Missing skill name'));
      p.log.message(pc.dim('Usage: skills enable <skill-name> [-g]'));
      process.exit(1);
    }

    const disabled = await getAllDisabledSkills(scope, cwd);
    const names = Object.keys(disabled);

    if (names.length === 0) {
      p.log.info(`${DIM}No disabled skills to enable (${scope}).${RESET}`);
      process.exit(0);
    }

    const choices = names.sort().map((n) => ({ value: n, label: n }));

    const selected = await p.multiselect({
      message: `Select skills to enable ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Enable cancelled');
      process.exit(0);
    }

    const selectedNames = selected as string[];
    for (const name of selectedNames) {
      await enableOne(name, isGlobal);
    }

    console.log();
    p.outro(pc.green(`Enabled ${selectedNames.length} skill(s)`));
    return;
  }

  // Specific skill name given
  await enableOne(rest[0]!, isGlobal);
  console.log();
  p.outro(pc.green('Done!'));
}

export async function runGroup(args: string[]): Promise<void> {
  const { global: isGlobal, rest } = parseScope(args);
  const cwd = process.cwd();
  const scope = isGlobal ? 'global' : 'project';
  const scopeLabel = isGlobal ? 'global' : 'project';

  if (rest.length === 0) {
    showGroupHelp();
    return;
  }

  const subcommand = rest[0]!;

  if (subcommand === 'list') {
    const groups = await getAllGroups(scope, cwd);
    if (Object.keys(groups).length === 0) {
      console.log(`${DIM}No groups defined (${scopeLabel}).${RESET}`);
      return;
    }
    console.log(`${pc.bold('Groups')} ${DIM}(${scopeLabel})${RESET}`);
    console.log();
    for (const [name, skills] of Object.entries(groups).sort()) {
      if (skills.length === 0) continue;
      console.log(`  ${CYAN}${name}${RESET}`);
      console.log(`    ${DIM}${skills.join(', ')}${RESET}`);
    }
    console.log();
    return;
  }

  if (rest.length < 2) {
    showGroupHelp();
    return;
  }

  const groupName = rest[0]!;
  const action = rest[1]!;

  if (action === 'list' || action === 'ls') {
    const skills = await getGroup(groupName, scope, cwd);
    if (!skills || skills.length === 0) {
      console.log(`${DIM}Group "${groupName}" is empty or does not exist (${scopeLabel}).${RESET}`);
      return;
    }
    console.log(`${pc.bold(groupName)} ${DIM}(${scopeLabel})${RESET}`);
    console.log();
    const installedSkills = await listInstalledSkills({ global: isGlobal });
    for (const skill of skills) {
      const isInstalled = installedSkills.some((s) => s.name === skill);
      const disabled = await getDisabledSkill(skill, scope, cwd);
      const isDisabled = disabled !== null;
      const prefix = isDisabled
        ? `${YELLOW}[-]${RESET}`
        : isInstalled
          ? `${pc.green('[+]')}${RESET}`
          : `${DIM}[ ]${RESET}`;
      console.log(`  ${prefix} ${skill}`);
    }
    console.log();
    return;
  }

  const skillNames = rest.slice(2);

  if (action === 'add') {
    if (skillNames.length === 0) {
      if (!process.stdin.isTTY) {
        showGroupHelp();
        return;
      }

      const tracked = isGlobal ? await getAllLockedSkills() : (await readLocalLock(cwd)).skills;
      const disabled = await getAllDisabledSkills(scope, cwd);
      const allKnown = new Set([...Object.keys(tracked), ...Object.keys(disabled)]);
      const groupMembers = (await getGroup(groupName, scope, cwd)) || [];
      const ungrouped = [...allKnown].filter((s) => !groupMembers.includes(s)).sort();

      if (ungrouped.length === 0) {
        p.log.info(`${DIM}No ungrouped skills available to add.${RESET}`);
        return;
      }

      const choices = ungrouped.map((s) => ({ value: s, label: s }));
      const selected = await p.multiselect({
        message: `Select skills to add to "${groupName}" ${pc.dim('(space to toggle)')}`,
        options: choices,
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel('Add cancelled');
        process.exit(0);
      }

      const names = selected as string[];
      for (const n of names) {
        await addSkillToGroup(groupName, n, scope, cwd);
      }
      p.log.success(pc.green(`Added ${names.length} skill(s) to group "${groupName}"`));
      return;
    }

    for (const skillName of skillNames) {
      await addSkillToGroup(groupName, skillName, scope, cwd);
    }
    p.log.success(pc.green(`Added ${skillNames.length} skill(s) to group "${groupName}"`));
  } else if (action === 'remove' || action === 'rm') {
    if (skillNames.length === 0) {
      if (!process.stdin.isTTY) {
        showGroupHelp();
        return;
      }

      const groupMembers = (await getGroup(groupName, scope, cwd)) || [];
      if (groupMembers.length === 0) {
        p.log.info(`${DIM}No skills in group "${groupName}" to remove.${RESET}`);
        return;
      }

      const choices = groupMembers.map((s) => ({ value: s, label: s }));
      const selected = await p.multiselect({
        message: `Select skills to remove from "${groupName}" ${pc.dim('(space to toggle)')}`,
        options: choices,
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel('Remove cancelled');
        process.exit(0);
      }

      const names = selected as string[];
      for (const n of names) {
        await removeSkillFromGroup(groupName, n, scope, cwd);
      }
      p.log.success(pc.green(`Removed ${names.length} skill(s) from group "${groupName}"`));
      return;
    }

    for (const skillName of skillNames) {
      await removeSkillFromGroup(groupName, skillName, scope, cwd);
    }
    p.log.success(pc.green(`Removed ${skillNames.length} skill(s) from group "${groupName}"`));
  } else {
    showGroupHelp();
  }
}

function showGroupHelp(): void {
  console.log(`
${pc.bold('Usage:')} skills group <command> [options]

${pc.bold('Commands:')}
  list [-g]                        List all groups
  <name> list                      List skills in a group
  <name> add <skills...>           Add skills to a group
  <name> remove <skills...>        Remove skills from a group

${pc.bold('Options:')}
  -g, --global                     Use global scope instead of project

${pc.bold('Examples:')}
  ${DIM}$${RESET} skills group list
  ${DIM}$${RESET} skills group engineering add grill-with-docs pr-review
  ${DIM}$${RESET} skills group engineering remove pr-review
  ${DIM}$${RESET} skills group engineering list
`);
}
