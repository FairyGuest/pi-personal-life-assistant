import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LIFE_SKILLS = [
  { name: 'life-planning', domain: 'general', title: '长期规划与周复盘', description: '人生目标、阶段里程碑、周计划、复盘与取舍。' },
  { name: 'fitness-tracking', domain: 'fitness', title: '体重腰围与锻炼', description: '测量历史、BMI计算、分部位动作计划、逐组训练反馈与趋势复盘。' },
  { name: 'finance-planning', domain: 'finance', title: '理财与退休规划', description: '分阶段定投、现金缺口、通胀和退休提款情景。' },
  { name: 'career-search', domain: 'career', title: '求职与跳槽', description: '求职漏斗、岗位匹配、Agent项目表达和面试复盘。' },
  { name: 'learning-research', domain: 'learning', title: '学习与论文阅读', description: '主动回忆、阅读计划、论文检索与证据核验。' },
  { name: 'emotional-support', domain: 'relationships', title: '情感与压力支持', description: '共情、澄清、边界沟通与小步行动，不做诊断。' },
];

export function skillPath(name) {
  if (!LIFE_SKILLS.some(skill => skill.name === name)) throw new Error('只允许加载已安装的生活技能。');
  return fileURLToPath(new URL(`./skills/${name}/SKILL.md`, import.meta.url));
}

export function readLifeSkill(name) {
  return { ...LIFE_SKILLS.find(skill => skill.name === name), instructions: readFileSync(skillPath(name), 'utf8') };
}

export function scenarioInstructions(domains, prompt = '') {
  const explicit = prompt.match(/\/skill:([a-z-]+)|<skill name="([a-z-]+)"/)?.slice(1).find(Boolean);
  const selected = LIFE_SKILLS.filter(skill => (skill.domain !== 'general' && domains.includes(skill.domain)) || skill.name === explicit || (skill.domain === 'general' && (/规划|计划|复盘|目标|取舍|优先级/.test(prompt) || domains.length === 1)));
  return selected.map(skill => `## 场景技能：${skill.name}\n${readLifeSkill(skill.name).instructions}`).join('\n\n');
}
