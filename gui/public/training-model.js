export const TRAINING_LIMITS = { exercises: 30, sets: 50 };
export const BODY_LABELS = { full_body: '全身', chest: '胸部', back: '背部', legs: '腿臀', shoulders: '肩部', arms: '手臂', core: '核心' };
export const LOAD_BASES = { unknown: '未标注口径', total: '总重量（杠铃含杆）', per_hand: '单只哑铃重量', machine: '器械标示重量', added: '额外负重', bodyweight: '徒手 / 自重' };

export function entryFocuses(entry, planned) {
  const primary = entry.primary_focuses ?? entry.focuses ?? (entry.focus ? [entry.focus] : planned?.focuses ?? (planned?.focus ? [planned.focus] : []));
  return [...new Set([...primary, ...(entry.secondary_focuses ?? [])])];
}

export function expandSetGroup(group, unit = 'reps') {
  if (!group || !Number.isInteger(group.count) || group.count < 1 || group.count > TRAINING_LIMITS.sets) throw new Error(`组数请填写1—${TRAINING_LIMITS.sets}的整数。`);
  if (!['reps', 'seconds'].includes(unit)) throw new Error('记录单位无效。');
  const amount = group[unit];
  if (!Number.isInteger(amount) || amount < 1 || amount > (unit === 'reps' ? 100 : 14400)) throw new Error(unit === 'reps' ? '每组次数请填写1—100的整数。' : '每组秒数请填写1—14400的整数。');
  if (group[unit === 'reps' ? 'seconds' : 'reps'] != null) throw new Error('每组只填写次数或秒数之一。');
  if (group.load_kg != null && (!Number.isFinite(group.load_kg) || group.load_kg < 0 || group.load_kg > 500)) throw new Error('负重应为0—500kg，或留空表示未知。');
  if (group.rir != null && (!Number.isInteger(group.rir) || group.rir < 0 || group.rir > 10)) throw new Error('RIR应为0—10的整数，或留空。');
  return Array.from({ length: group.count }, () => ({ [unit]: amount, load_kg: group.load_kg ?? null, rir: group.rir ?? null }));
}

export function setsSummary(sets) {
  const groups = [];
  for (const set of sets) {
    const signature = JSON.stringify([set.reps ?? null, set.seconds ?? null, set.load_kg ?? null, set.rir ?? null]);
    const last = groups.at(-1);
    if (last?.signature === signature) last.count++;
    else groups.push({ set, count: 1, signature });
  }
  return groups.map(({ set, count }) => `${set.load_kg == null ? '负重未记' : `${set.load_kg}kg`} × ${set.seconds != null ? `${set.seconds}秒` : `${set.reps}次`} × ${count}组${set.rir == null ? '' : `（RIR ${set.rir}）`}`).join('；');
}
