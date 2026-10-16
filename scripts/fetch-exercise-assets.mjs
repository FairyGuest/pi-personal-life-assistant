import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MACHINE_EXERCISES } from './machine-exercises.mjs';
import { IMAGE_SUPPLEMENTS, withImageSupplements } from './supplemental-exercise-images.mjs';

const definitions = [
  [73, '杠铃卧推', 'barbell', ['chest'], ['arms', 'shoulders'], '胸大肌', '肱三头肌、肩部'],
  [75, '哑铃卧推', 'dumbbells', ['chest'], ['arms', 'shoulders'], '胸大肌', '肱三头肌、肩部'],
  [537, '上斜哑铃卧推', 'dumbbells', ['chest'], ['arms', 'shoulders'], '胸部', '肱三头肌、肩部'],
  [538, '上斜杠铃卧推', 'barbell', ['chest'], ['arms', 'shoulders'], '胸部', '肱三头肌、肩部'],
  [76, '窄握杠铃卧推', 'barbell', ['arms', 'chest'], ['shoulders'], '肱三头肌、胸部', '肩部'],
  [135, '蝴蝶机夹胸', 'machine', ['chest'], ['shoulders'], '胸大肌', '肩部'],
  [394, '坐姿绳索划船', 'cable', ['back'], ['arms'], '背阔肌、背部', '肱二头肌、肱肌'],
  [83, '俯身杠铃划船', 'barbell', ['back'], ['arms', 'shoulders'], '背部', '手臂、肩部'],
  [152, '反手引体向上', 'bodyweight', ['back', 'arms'], [], '背阔肌、肱二头肌', '背部稳定肌群'],
  [91, '杠铃弯举', 'barbell', ['arms'], [], '肱二头肌', '肱肌（同属手臂）'],
  [92, '哑铃弯举', 'dumbbells', ['arms'], [], '肱二头肌', '肱肌（同属手臂）'],
  [95, '绳索弯举', 'cable', ['arms'], [], '手臂屈肘肌群', '前臂（同属手臂）'],
  [272, '哑铃锤式弯举', 'dumbbells', ['arms'], [], '手臂屈肘肌群', '前臂（同属手臂）'],
  [246, '仰卧曲杆臂屈伸', 'barbell', ['arms'], [], '肱三头肌', '按动作幅度与稳定方式而异'],
  [348, '哑铃侧平举', 'dumbbells', ['shoulders'], [], '肩部（三角肌）', '肩胛稳定肌群'],
  [567, '坐姿哑铃推举', 'dumbbells', ['shoulders'], ['arms'], '肩部（三角肌）', '肱三头肌'],
  [257, '杠铃前蹲', 'barbell', ['legs'], ['core'], '腿臀肌群', '核心稳定肌群'],
  [206, '哑铃行走弓步', 'dumbbells', ['legs'], ['core'], '股四头肌、臀部', '核心稳定肌群'],
  [365, '俯卧腿弯举', 'machine', ['legs'], [], '大腿后侧（腘绳肌）', '小腿参与程度因姿势而异'],
  [366, '坐姿腿弯举', 'machine', ['legs'], [], '大腿后侧（腘绳肌）', '按器械与动作方式而异'],
  [167, '卷腹', 'bodyweight', ['core'], [], '腹直肌', '腹部稳定肌群'],
];
const root = new URL('../gui/public/', import.meta.url);
mkdirSync(new URL('exercise-images/', root), { recursive: true });
const machinesOnly = process.argv.includes('--machines-only');
const existing = machinesOnly ? JSON.parse(readFileSync(new URL('exercise-catalog.json', root), 'utf8')).records : [];
const records = existing.filter(record => !MACHINE_EXERCISES.some(exercise => record.id === `wger-${exercise.id}`));
const entries = [...(machinesOnly ? [] : definitions.map(([id, name, equipment, primary_focuses, secondary_focuses, primary_muscles, secondary_muscles]) => ({ id, name, equipment, primary_focuses, secondary_focuses, primary_muscles, secondary_muscles }))), ...MACHINE_EXERCISES];
for (const definition of entries) {
  const { id, name, equipment, primary_focuses, secondary_focuses, primary_muscles, secondary_muscles } = definition;
  const source = `https://wger.de/api/v2/exerciseinfo/${id}/`;
  const response = await fetch(source, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Metadata ${id}: ${response.status}`);
  const data = await response.json();
  const english = data.translations.find(item => item.language === 2)?.name;
  if (!english || (definition.english && definition.english !== english)) throw new Error(`Exercise identity needs review: ${id}`);
  const author = id === 543 ? 'wger.de' : 'Everkinetic';
  const candidates = data.images.filter(item => item.license === 1 && item.license_author === author && item.is_ai_generated === false && (!definition.image_ids || definition.image_ids.includes(item.id))).sort((first, second) => first.image.localeCompare(second.image)).slice(0, 2);
  if (definition.image_ids ? candidates.length !== definition.image_ids.length : !candidates.length) throw new Error(`Reviewed, attributed images changed for ${id}`);
  const images = [];
  for (const item of candidates) {
    const remote = new URL(item.image);
    if (remote.origin !== 'https://wger.de' || !remote.pathname.startsWith('/media/exercise-images/') || !remote.pathname.endsWith('.png')) throw new Error(`Unexpected asset: ${id}`);
    const download = await fetch(remote, { signal: AbortSignal.timeout(25000), redirect: 'error' });
    if (!download.ok) throw new Error(`Image ${id}: ${download.status}`);
    const buffer = Buffer.from(await download.arrayBuffer());
    if (buffer.length > 3000000 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${id}`);
    const filename = `exercise-images/wger-${id}-${item.id}.png`;
    writeFileSync(new URL(filename, root), buffer);
    images.push({ path: `/${filename}`, source: item.image, author: item.license_author, license: 'CC BY-SA 3.0', license_url: 'https://creativecommons.org/licenses/by-sa/3.0/', sha256: createHash('sha256').update(buffer).digest('hex'), modifications: '未修改原图；界面仅缩放显示' });
  }
  records.push({ id: `wger-${id}`, name, english, equipment, primary_focuses, secondary_focuses, primary_muscles, secondary_muscles, tracking_unit: 'reps', source, images, ...(definition.aliases ? { aliases: definition.aliases, guide: definition.guide, ...(definition.equipment_note ? { equipment_note: definition.equipment_note } : {}) } : {}) });
  process.stdout.write(`${name}: ${images.length} attributed images\n`);
}
if (!machinesOnly) records.push({ id: 'local-plank', name: '前臂平板支撑', english: 'Forearm Plank', equipment: 'bodyweight', primary_focuses: ['core'], secondary_focuses: ['shoulders', 'legs'], primary_muscles: '腹部核心肌群', secondary_muscles: '肩部、腿臀等稳定肌群', tracking_unit: 'seconds', source: 'https://www.acefitness.org/resources/everyone/exercise-library/', images: [{ path: '/exercise-images/plank.svg', author: '本项目原创示意', license: '原创SVG', modifications: '简化侧视示意，不是动作姿势评估' }] });
writeFileSync(new URL('exercise-catalog.json', root), JSON.stringify({ reviewed_at: IMAGE_SUPPLEMENTS.reviewed_at, note: '主练/协同是一般参考，不表示相同训练量或个人医疗适用性；可按实际动作调整。', records: withImageSupplements(records) }, null, 2) + '\n');
process.stdout.write(`Saved ${records.length} exercises; no user workout data accessed.\n`);
