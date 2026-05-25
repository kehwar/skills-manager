import {
  getDefaultAgents as getGlobalDefaultAgents,
  setDefaultAgents as setGlobalDefaultAgents,
} from './skill-lock.ts';
import { getLocalDefaultAgents, setLocalDefaultAgents } from './local-lock.ts';
import { agents } from './agents.ts';
import type { AgentType } from './types.ts';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

function isGlobal(args: string[]): boolean {
  return args.includes('-g') || args.includes('--global');
}

function stripScopeFlags(args: string[]): string[] {
  return args.filter((a) => a !== '-g' && a !== '--global');
}

/**
 * Get default agents, filtered to only valid agents.
 *
 * @param scope - 'project' reads from skills-lock.json, 'global' reads from ~/.agents/.skill-lock.json.
 *                Defaults to checking project first, then global as fallback.
 */
export async function getValidatedDefaultAgents(
  scope?: 'project' | 'global'
): Promise<AgentType[] | undefined> {
  const validAgents = Object.keys(agents);

  const filter = (list: string[] | undefined): AgentType[] | undefined => {
    if (!list || list.length === 0) return undefined;
    const filtered = list.filter((a) => validAgents.includes(a)) as AgentType[];
    return filtered.length > 0 ? filtered : undefined;
  };

  if (scope === 'project') {
    return filter(await getLocalDefaultAgents());
  }
  if (scope === 'global') {
    return filter(await getGlobalDefaultAgents());
  }

  // No scope: project first, then global fallback
  return filter(await getLocalDefaultAgents()) ?? filter(await getGlobalDefaultAgents());
}

export async function runSetAgents(args: string[]): Promise<void> {
  if (args[0] !== 'agents') {
    console.log(`Unknown set command: ${args[0]}`);
    console.log(`Usage: skills set agents <agent1> <agent2> ...`);
    process.exit(1);
  }

  const global = isGlobal(args);
  const cleanArgs = stripScopeFlags(args);
  const agentNames = cleanArgs.slice(1).filter((a) => !a.startsWith('-'));
  const validAgents = Object.keys(agents);
  const scopeLabel = global ? 'global' : 'project';

  if (agentNames.length === 0 && !cleanArgs.includes('--clear')) {
    const current = global ? await getGlobalDefaultAgents() : await getLocalDefaultAgents();
    if (current && current.length > 0) {
      console.log(`${TEXT}Current ${scopeLabel} default agents:${RESET}`);
      for (const a of current) {
        console.log(`  ${TEXT}${a}${RESET}`);
      }
    } else {
      console.log(`${DIM}No ${scopeLabel} default agents configured.${RESET}`);
      console.log(`${DIM}Usage: skills set agents [<agent1> <agent2> ...] [-g]${RESET}`);
    }
  } else if (cleanArgs.includes('--clear') || agentNames.length === 0) {
    if (global) {
      await setGlobalDefaultAgents([]);
    } else {
      await setLocalDefaultAgents([]);
    }
    console.log(`${TEXT}${scopeLabel} default agents cleared.${RESET}`);
  } else {
    const invalidAgents = agentNames.filter((a) => !validAgents.includes(a));
    if (invalidAgents.length > 0) {
      console.log(`${TEXT}Invalid agents: ${invalidAgents.join(', ')}${RESET}`);
      console.log(`${DIM}Valid agents: ${validAgents.join(', ')}${RESET}`);
      process.exit(1);
    }
    if (global) {
      await setGlobalDefaultAgents(agentNames);
    } else {
      await setLocalDefaultAgents(agentNames);
    }
    console.log(`${TEXT}${scopeLabel} default agents set to: ${agentNames.join(', ')}${RESET}`);
  }
}
