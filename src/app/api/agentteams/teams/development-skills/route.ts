import { NextResponse } from 'next/server';
import { DEVELOPMENT_ROLES, DEVELOPMENT_SQUAD_SKILL_BASE, DEVELOPMENT_SQUAD_SKILL_VERSION } from '@/lib/development-squad-template';
import { parseSkillFrontmatter } from '@/lib/skill-package';

export async function GET() {
  try {
    const sourceBase = process.env.AGENTTEAMS_DEVELOPMENT_SKILLS_BASE_URL || DEVELOPMENT_SQUAD_SKILL_BASE;
    // Fixed public URLs only. Browser credentials are never forwarded to the website.
    const skills = await Promise.all(DEVELOPMENT_ROLES.map(async role => {
      const response = await fetch(`${sourceBase}/${role.skillName}/SKILL.md`, {
        redirect: 'error', signal: AbortSignal.timeout(10000), next: { revalidate: 300 },
      });
      if (!response.ok) throw new Error(`${role.title} Skill 读取失败（HTTP ${response.status}）`);
      const content = await response.text();
      if (parseSkillFrontmatter(content).name !== role.skillName) throw new Error(`${role.title} Skill 名称不匹配`);
      return { name: role.skillName, content };
    }));
    return NextResponse.json({ version: DEVELOPMENT_SQUAD_SKILL_VERSION, skills });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '官网 Skill 读取失败' }, { status: 502 });
  }
}
