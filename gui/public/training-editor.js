import { BODY_LABELS, LOAD_BASES, TRAINING_LIMITS, expandSetGroup, setsSummary } from './training-model.js';

const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const button = (text, callback, className = 'secondary') => { const element = node('button', className, text); element.type = 'button'; element.addEventListener('click', callback); return element; };
const equipmentLabels = { machine: '固定器械', cable: '绳索 / 龙门架', barbell: '杠铃', dumbbells: '哑铃', bodyweight: '自重' };
function field(container, label, type, value = '', attributes = {}) {
  const wrapper = node('label', 'form-field'); const input = node('input'); input.type = type; input.value = value ?? ''; Object.assign(input, attributes); wrapper.append(node('span', '', label), input); container.append(wrapper); return input;
}
function select(container, label, values, value) {
  const wrapper = node('label', 'form-field'); const input = node('select'); input.setAttribute('aria-label', label);
  for (const [key, title] of Object.entries(values)) { const option = node('option', '', title); option.value = key; input.append(option); }
  input.value = value; wrapper.append(node('span', '', label), input); container.append(wrapper); return input;
}
function reference(container, exercise) {
  const images = node('div', 'exercise-illustrations');
  exercise.images.forEach((asset, index) => {
    const figure = node('figure', 'exercise-illustration'); const image = node('img');
    image.src = asset.path; image.alt = `${exercise.name} · ${asset.caption || `动作示意 ${index + 1}`}`; image.loading = 'lazy';
    if (asset.rendering === 'invert') image.classList.add('exercise-image-inverted');
    image.addEventListener('error', () => image.replaceWith(node('span', 'form-warning', '图片未能加载，请查看来源或动作名称。')), { once: true });
    figure.append(image); if (asset.caption) figure.append(node('figcaption', '', asset.caption)); images.append(figure);
  });
  if (exercise.images.length) container.append(images);
  else container.append(node('p', 'form-description', '图示暂缺：尚未收录动作匹配且授权明确的配图，不使用其他动作图片代替。请结合下方要点与现场器械铭牌。'));
  if (exercise.image_note) container.append(node('p', 'form-description', exercise.image_note));
  container.append(node('p', 'exercise-muscle-line', `主练：${exercise.primary_muscles} · 协同：${exercise.secondary_muscles}`));
  if (exercise.aliases?.length) container.append(node('p', 'form-description', `常用名称：${exercise.aliases.join('、')}`));
  if (exercise.guide) container.append(node('p', 'form-description', `使用要点：${exercise.guide}`));
  if (exercise.equipment_note) container.append(node('p', 'form-description', `器械与记录：${exercise.equipment_note}`));
  const credit = node('p', 'exercise-credit'); const source = node('a', '', '动作资料'); source.href = exercise.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; credit.append(source);
  for (const [index, asset] of exercise.images.entries()) {
    credit.append(document.createTextNode(` · ${asset.author} / `));
    if (asset.license_url) { const license = node('a', '', asset.license); license.href = asset.license_url; license.target = '_blank'; license.rel = 'noopener noreferrer'; credit.append(license); }
    else credit.append(document.createTextNode(asset.license));
    if (asset.source) { const original = node('a', '', ` · 原图${index + 1}`); original.href = asset.source; original.target = '_blank'; original.rel = 'noopener noreferrer'; credit.append(original); }
  }
  container.append(credit);
}

export function showExerciseLibrary({ library = [], selectedIds = [], onSelect, onCustom, selectionLabel = '添加所选', multiple = true, initialFocus = '' }) {
  if (document.querySelector('.exercise-picker-dialog')) return;
  const dialog = node('dialog', 'exercise-picker-dialog'); const selected = new Map(); const existing = new Set(selectedIds);
  dialog.setAttribute('aria-label', '动作库');
  const heading = node('h2', '', `动作库 · ${library.length}个动作 · ${library.filter(exercise => exercise.images.length).length}个有图解`); const controls = node('div', 'exercise-picker-filters');
  const search = field(controls, '搜索动作（中文 / 英文）', 'search', '', { placeholder: '如：推胸机、倒蹬、开腿机、curl' });
  const muscle = select(controls, '按参与部位筛选', { '': '全部部位', ...BODY_LABELS }, initialFocus);
  const equipment = select(controls, '按器材筛选', { '': '全部器材', ...equipmentLabels }, '');
  const quickFilters = node('div', 'row-actions'); const filterButtons = [];
  for (const [value, label] of [['', '全部器材'], ['machine', `固定器械（${library.filter(item => item.equipment === 'machine').length}）`], ['cable', `绳索 / 龙门架（${library.filter(item => item.equipment === 'cable').length}）`]]) {
    const control = button(label, () => { equipment.value = value; render(); }); filterButtons.push({ value, control }); quickFilters.append(control);
  }
  quickFilters.append(button('清空筛选', () => { search.value = ''; muscle.value = ''; equipment.value = ''; render(); search.focus(); }));
  const resultCount = node('p', 'form-description'); resultCount.setAttribute('aria-live', 'polite');
  const selection = node('section', 'exercise-selection-summary'); selection.setAttribute('aria-label', '待添加的动作');
  const selectionTitle = node('strong'); const selectedList = node('div', 'exercise-selection-list');
  const clearSelection = button('清空待选', () => { selected.clear(); render(); search.focus(); });
  const selectionHeading = node('div', 'exercise-selection-heading'); selectionHeading.append(selectionTitle, clearSelection);
  selection.append(selectionHeading, node('p', 'form-description', '切换筛选不会清空选择，点击动作名称可取消；尚未添加或保存训练。'), selectedList);
  const results = node('div', 'exercise-picker-results'); const error = node('p', 'form-error'); error.setAttribute('role', 'alert');
  const close = () => { dialog.close(); dialog.remove(); };
  const apply = button(`${selectionLabel}（0）`, async () => {
    apply.disabled = true;
    try {
      if (!selected.size) throw new Error('请先选择至少一个动作。');
      if (selected.size > TRAINING_LIMITS.exercises) throw new Error(`每次最多${TRAINING_LIMITS.exercises}个动作，请减少选择。`);
      const target = await onSelect([...selected.values()]);
      close(); target?.scrollIntoView({ block: 'start' });
    } catch (failure) { error.textContent = failure.message; }
    finally { apply.disabled = false; }
  }, 'primary');
  function refreshSelection() {
    apply.textContent = `${selectionLabel}（${selected.size}）`; selection.hidden = !selected.size;
    selectionTitle.textContent = `已选 ${selected.size} 个动作`; selectedList.replaceChildren();
    for (const exercise of selected.values()) {
      const remove = button(`${exercise.name} ×`, () => {
        selected.delete(exercise.id);
        for (const input of results.querySelectorAll('input')) input.checked = selected.has(input.value);
        refreshSelection(); (selected.size ? clearSelection : search).focus({ preventScroll: true });
      });
      remove.setAttribute('aria-label', `取消选择${exercise.name}`); selectedList.append(remove);
    }
  }
  function render() {
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean); results.replaceChildren();
    for (const { value, control } of filterButtons) { control.setAttribute('aria-pressed', String(equipment.value === value)); control.className = equipment.value === value ? 'primary' : 'secondary'; }
    const filtered = library.filter(item => {
      const searchable = [item.name, item.english, ...(item.aliases || []), equipmentLabels[item.equipment], item.primary_muscles, item.secondary_muscles].join(' ').toLocaleLowerCase();
      return terms.every(term => searchable.includes(term)) && (!muscle.value || [...item.primary_focuses, ...item.secondary_focuses].includes(muscle.value)) && (!equipment.value || item.equipment === equipment.value);
    });
    resultCount.textContent = `找到 ${filtered.length} / ${library.length} 个动作`;
    if (!filtered.length) results.append(node('p', 'form-description', library.length ? '没有匹配动作，可更换关键词或选择自定义动作。' : '动作库尚未加载。请重新打开助手并按提示确认更新；也可先记录自定义动作。'));
    for (const exercise of filtered) {
      const card = node('article', 'exercise-option'); const label = node('label', 'exercise-option-title'); const checkbox = node('input'); checkbox.type = multiple ? 'checkbox' : 'radio'; checkbox.name = 'exercise-selection'; checkbox.value = exercise.id; checkbox.checked = selected.has(exercise.id); checkbox.disabled = existing.has(exercise.id);
      checkbox.setAttribute('aria-label', `选择${exercise.name}`); label.append(checkbox, node('strong', '', exercise.name), node('small', '', equipmentLabels[exercise.equipment])); card.append(label); reference(card, exercise);
      if (checkbox.disabled) card.append(node('small', '', '已在本次训练中，请在原动作下追加组数。'));
      checkbox.addEventListener('change', () => { if (!multiple) selected.clear(); if (checkbox.checked) selected.set(exercise.id, exercise); else selected.delete(exercise.id); refreshSelection(); error.textContent = ''; }); results.append(card);
    }
    refreshSelection();
  }
  search.addEventListener('input', render); muscle.addEventListener('change', render); equipment.addEventListener('change', render);
  const footer = node('div', 'exercise-picker-footer'); footer.append(button('取消', close));
  if (onCustom) footer.append(button('自定义动作', async () => { try { const target = await onCustom(); close(); target?.scrollIntoView({ block: 'start' }); } catch (failure) { error.textContent = failure.message; } }));
  footer.append(apply);
  dialog.append(heading, node('p', 'form-description', '可浏览图解和文字要点，也可勾选动作开始记录。图片与筛选均在本地，不发送训练数据；选择动作不代表完成训练，组数需自己填写。器械型号不同，请按现场铭牌调节；有疼痛请停止。'), quickFilters, controls, resultCount, selection, results, error, footer);
  if (!multiple) controls.before(node('p', 'form-description', '选择一个动作替换当前卡片。默认按当前主练部位筛选，可切换全部部位；同部位不代表等效替代，已填写的组数不会转移到另一个动作。'));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); document.body.append(dialog); render(); dialog.showModal(); search.focus();
}

export function createTrainingExerciseEditor({ helper, previous, independent, options, initialExercises = [], onPlanExerciseRemoved }) {
  const library = options.exerciseLibrary?.records || [];
  const cards = []; const list = node('div', 'training-exercise-list full-width');
  const status = node('p', 'form-description full-width'); status.setAttribute('aria-live', 'polite');
  helper.fields.append(status, list);
  const refresh = () => { status.textContent = `已添加 ${cards.length} / ${TRAINING_LIMITS.exercises} 个动作；主练与协同不代表相同训练量。`; cards.forEach((card, index) => { card.position.textContent = `动作 ${index + 1} · ${card.nameInput.value.trim() || '自定义动作'}`; }); };

  function addExercise(planned, saved, catalog, scroll = false) {
    if (cards.length >= TRAINING_LIMITS.exercises) throw new Error(`每次最多${TRAINING_LIMITS.exercises}个动作。`);
    const wrapper = node('section', 'exercise-log'); const header = node('div', 'exercise-card-heading'); const position = node('strong');
    const title = field(wrapper, '动作名称', 'text', planned?.name || saved?.name || catalog?.name || '', { maxLength: 60, placeholder: '输入动作名，或从动作库选择' }); title.setAttribute('aria-label', '自定义动作名称');
    const card = { wrapper, position, nameInput: title, catalogId: saved?.catalog_id || catalog?.id, rows: [] }; cards.push(card);
    const choices = node('div', 'row-actions');
    choices.append(button('选择备选动作', () => showExerciseLibrary({ library, selectedIds: cards.map(item => item.catalogId), multiple: false, initialFocus: selected('primary')[0] || '', selectionLabel: '使用此动作', onSelect: ([exercise]) => {
      if (card.rows.length || load.value || amount.value || count.value) throw new Error('此动作已有逐组或批量输入，不能覆盖或转移给备选动作。请取消后用“添加动作”另加备选，或先清空本动作的组数与批量输入再更换。');
      const index = cards.indexOf(card); cards.splice(index, 1);
      const replacement = addExercise(null, null, exercise); cards.pop(); cards.splice(index, 0, replacement);
      wrapper.replaceWith(replacement.wrapper); refresh(); if (planned) onPlanExerciseRemoved?.();
      return replacement.wrapper;
    } })), button('移除此动作', () => { cards.splice(cards.indexOf(card), 1); wrapper.remove(); refresh(); if (planned) onPlanExerciseRemoved?.(); }));
    header.append(position, choices); wrapper.prepend(header);
    if (planned) { title.readOnly = true; wrapper.append(node('p', 'form-description', `参考计划：${planned.sets}组 × ${planned.reps}；这里只记录实际做过的组。`)); }
    let illustration;
    if (catalog) { illustration = node('details', 'exercise-reference'); illustration.open = true; illustration.append(node('summary', '', catalog.images.length ? '动作示意与肌群参考（点击可收起）' : '动作要点与肌群参考（点击可收起）')); reference(illustration, catalog); wrapper.append(illustration); }
    else wrapper.append(node('p', 'form-description', '此动作尚无关联图解。可从上方“从动作库选择”添加带图片的动作；手填动作名不会自动猜测匹配。'));
    title.addEventListener('input', () => { if (catalog) { const changed = title.value.trim() !== catalog.name; card.catalogId = changed ? undefined : catalog.id; illustration.hidden = changed; } refresh(); });
    const settings = node('div', 'exercise-settings'); wrapper.append(settings);
    const unit = select(settings, '记录单位', { reps: '次数', seconds: '秒数' }, planned?.tracking_unit || saved?.tracking_unit || catalog?.tracking_unit || 'reps');
    const basis = select(settings, '负重口径', LOAD_BASES, saved?.load_basis || 'unknown');
    const muscles = node('details', 'exercise-muscles'); const muscleSummary = node('summary'); muscles.append(muscleSummary);
    const initialPrimary = saved?.primary_focuses ?? saved?.focuses ?? (saved?.focus ? [saved.focus] : catalog?.primary_focuses ?? (planned?.focus ? [planned.focus] : []));
    const initialSecondary = saved?.secondary_focuses ?? catalog?.secondary_focuses ?? [];
    const checks = { primary: [], secondary: [] };
    for (const [kind, label, initial] of [['primary', '主练部位（可多选）', initialPrimary], ['secondary', '协同部位（可多选）', initialSecondary]]) {
      const group = node('fieldset', 'muscle-selector'); group.append(node('legend', '', label));
      for (const [key, label] of Object.entries(BODY_LABELS)) {
        const choice = node('label', 'muscle-choice'); const input = node('input'); input.type = 'checkbox'; input.value = key; input.checked = initial.includes(key); input.setAttribute('aria-label', `${kind === 'primary' ? '主练' : '协同'}${label}`); choice.append(input, node('span', '', label)); group.append(choice); checks[kind].push(input);
        input.addEventListener('change', () => { if (input.checked) for (const other of [...checks.primary, ...checks.secondary]) if (other !== input && (other.value === key || other.value === 'full_body' || key === 'full_body')) other.checked = false; updateMuscles(); });
      }
      muscles.append(group);
    }
    const selected = kind => checks[kind].filter(input => input.checked).map(input => input.value);
    function updateMuscles() { muscleSummary.textContent = `主练：${selected('primary').map(key => BODY_LABELS[key]).join('＋') || '请选择'} · 协同：${selected('secondary').map(key => BODY_LABELS[key]).join('＋') || '未指定'}（可调整）`; }
    updateMuscles(); if (!initialPrimary.length) muscles.open = true; wrapper.append(muscles);
    const bulk = node('div', 'set-multiplier');
    const load = field(bulk, '负重 kg（可空）', 'number', '', { min: 0, max: 500, step: '0.1', placeholder: '如40' });
    const amount = field(bulk, unit.value === 'seconds' ? '每组秒数' : '每组次数', 'number', '', { min: 1, max: unit.value === 'seconds' ? 14400 : 100, step: 1, placeholder: unit.value === 'seconds' ? '如30' : '如10' });
    const count = field(bulk, '做了多少组', 'number', '', { min: 1, max: TRAINING_LIMITS.sets, step: 1, placeholder: '如4' });
    wrapper.append(bulk);
    const error = node('p', 'form-error'); error.setAttribute('role', 'alert');
    const details = node('details', 'exercise-set-details'); const summary = node('summary', '', '尚未录入实际组数'); const rows = node('div', 'exercise-sets'); details.append(summary, rows);
    function readRows() {
      return card.rows.flatMap(row => {
        if (!row.amount.value) { if (row.load.value || row.rir.value) throw new Error('填写负重或RIR时也请填写该组次数/秒数。'); return []; }
        return [{ [unit.value]: Number(row.amount.value), load_kg: row.load.value === '' ? null : Number(row.load.value), rir: row.rir.value === '' ? null : Number(row.rir.value) }];
      });
    }
    const updateSummary = () => { try { const sets = readRows(); summary.textContent = sets.length ? `${setsSummary(sets)} · 展开逐组修改` : '展开逐组输入（尚无已填组数）'; } catch { summary.textContent = '逐组记录尚未填完整，展开检查'; } };
    function addSet(savedSet) {
      if (card.rows.length >= TRAINING_LIMITS.sets) throw new Error(`每个动作最多${TRAINING_LIMITS.sets}组。`);
      const group = node('div', 'exercise-set-row'); const index = node('span', 'set-number');
      const setLoad = field(group, 'kg', 'number', savedSet?.load_kg, { min: 0, max: 500, step: '0.1' }); setLoad.setAttribute('aria-label', '本组负重kg');
      const setAmount = field(group, unit.value === 'seconds' ? '秒' : '次', 'number', savedSet?.[unit.value], { min: 1, max: unit.value === 'seconds' ? 14400 : 100, step: 1 }); setAmount.setAttribute('aria-label', unit.value === 'seconds' ? '本组秒数' : '本组次数');
      const rir = field(group, 'RIR', 'number', savedSet?.rir, { min: 0, max: 10, step: 1 }); rir.setAttribute('aria-label', '本组剩余次数RIR');
      const row = { group, amount: setAmount, load: setLoad, rir, index }; card.rows.push(row); group.prepend(index);
      group.append(button('删除组', () => { card.rows.splice(card.rows.indexOf(row), 1); group.remove(); card.rows.forEach((item, index) => { item.index.textContent = index + 1; }); updateSummary(); }));
      card.rows.forEach((item, index) => { item.index.textContent = index + 1; }); group.addEventListener('input', updateSummary); rows.append(group); updateSummary(); return row;
    }
    const bulkActions = node('div', 'row-actions');
    bulkActions.append(button('加入这些组', () => {
      try {
        const sets = expandSetGroup({ count: Number(count.value), [unit.value]: Number(amount.value), load_kg: load.value === '' ? null : Number(load.value) }, unit.value);
        if (card.rows.length + sets.length > TRAINING_LIMITS.sets) throw new Error(`加入后超过${TRAINING_LIMITS.sets}组。`);
        sets.forEach(addSet); amount.value = ''; count.value = ''; error.textContent = ''; details.open = false;
      } catch (failure) { error.textContent = failure.message; }
    }, 'primary'), button('＋ 单独加一组', () => { try { addSet(); details.open = true; error.textContent = ''; card.rows.at(-1).amount.focus(); } catch (failure) { error.textContent = failure.message; } }));
    let clearing = false;
    const clear = button('清空已录组数', () => { if (!clearing && card.rows.length) { clearing = true; clear.textContent = '确认清空这些组'; return; } rows.replaceChildren(); card.rows.length = 0; clearing = false; clear.textContent = '清空已录组数'; updateSummary(); });
    bulkActions.append(clear); wrapper.append(bulkActions, error, details);
    let currentUnit = unit.value;
    unit.addEventListener('change', () => {
      if (card.rows.length || amount.value || count.value) { unit.value = currentUnit; error.textContent = '请先清空已录组数及批量次数、组数，再切换单位；不会把次数悄悄当成秒数。'; return; }
      currentUnit = unit.value; amount.closest('label').querySelector('span').textContent = unit.value === 'seconds' ? '每组秒数' : '每组次数'; amount.max = unit.value === 'seconds' ? 14400 : 100; amount.placeholder = unit.value === 'seconds' ? '如30' : '如10'; error.textContent = '';
    });
    if (planned) unit.disabled = true;
    for (const set of saved?.sets || []) addSet(set);
    card.collect = (allowEmpty = false) => {
      if (amount.value || count.value) throw new Error(`「${title.value || '未命名动作'}」还有未加入的批量输入，请先点击“加入这些组”。`);
      const sets = readRows(); if (!sets.length) { if (planned || allowEmpty || (!title.value.trim() && !load.value)) return null; throw new Error(`「${title.value || '未命名动作'}」还没有实际组数；请填写，或移除此动作。`); }
      return { exercise_id: planned?.id || 'custom', name: title.value, primary_focuses: selected('primary'), secondary_focuses: selected('secondary'), tracking_unit: unit.value, load_basis: basis.value, ...(card.catalogId ? { catalog_id: card.catalogId } : {}), sets };
    };
    card.empty = () => !title.value.trim() && !card.rows.length && !amount.value && !count.value && !load.value;
    list.append(wrapper); refresh(); if (scroll) { wrapper.scrollIntoView({ block: 'start' }); title.focus({ preventScroll: true }); }
    return card;
  }

  function showPicker() {
    showExerciseLibrary({ library, selectedIds: cards.map(card => card.catalogId), onSelect: selected => {
        const empty = cards.filter(card => card.empty());
        if (cards.length - empty.length + selected.length > TRAINING_LIMITS.exercises) throw new Error(`合计超过${TRAINING_LIMITS.exercises}个动作，请减少选择。`);
        for (const card of empty) { cards.splice(cards.indexOf(card), 1); card.wrapper.remove(); }
        let last; for (const exercise of selected) last = addExercise(null, null, exercise);
        return last?.wrapper;
      }, onCustom: () => addExercise(null, null, null, true).wrapper });
  }
  const toolbar = node('section', 'exercise-library-toolbar full-width');
  const introduction = node('div'); introduction.append(node('strong', '', '先选动作，再记录实际组数'), node('p', 'form-description', library.length ? `${library.length}个动作 · 含固定器械/绳索 · 图解与文字要点 · 支持一次多选` : '动作库未加载，请重新打开助手确认更新；也可自定义录入。'));
  toolbar.append(introduction, button('从动作库选择', showPicker, 'primary')); helper.fields.prepend(toolbar);
  const add = button('＋ 添加动作', showPicker, 'primary'); helper.editActions.append(add);
  helper.fields.append(button('＋ 在末尾添加动作', showPicker, 'secondary full-width'));
  if (!independent) for (const planned of previous.plan.exercises) addExercise(planned, previous.actual?.entries?.find(entry => entry.exercise_id === planned.id));
  for (const saved of previous?.actual?.entries || []) if (independent || saved.exercise_id === 'custom') addExercise(null, saved, library.find(item => item.id === saved.catalog_id));
  if (!previous) {
    const initialIds = new Set(initialExercises.map(exercise => exercise.id));
    const selected = library.filter(exercise => initialIds.has(exercise.id)).slice(0, TRAINING_LIMITS.exercises);
    if (selected.length) for (const exercise of selected) addExercise(null, null, exercise);
    else addExercise();
  }
  refresh();
  return { collect: ({ allowEmpty = false } = {}) => cards.map(card => card.collect(allowEmpty)).filter(Boolean) };
}
