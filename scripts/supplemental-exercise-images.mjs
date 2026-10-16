import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const IMAGE_SUPPLEMENTS = JSON.parse(readFileSync(new URL('./exercise-image-supplements.json', import.meta.url), 'utf8'));
const assetRoot = new URL('../gui/public/', import.meta.url);
const readLocalAsset = assetPath => readFileSync(new URL(assetPath.slice(1), assetRoot));

export function withImageSupplements(records, { readAsset = readLocalAsset } = {}) {
  const supplements = new Map(IMAGE_SUPPLEMENTS.records.map(record => [record.id, record]));
  const identities = new Map(records.map(record => [record.id, record]));
  if (identities.size !== records.length || supplements.size !== IMAGE_SUPPLEMENTS.records.length) throw new Error('Duplicate exercise identity.');
  const paths = new Set();
  for (const supplement of supplements.values()) {
    const exercise = identities.get(supplement.id);
    if (!exercise || exercise.english !== supplement.english || exercise.equipment !== supplement.equipment) throw new Error(`Supplement identity needs review: ${supplement.id}`);
    for (const image of supplement.images) {
      if (!/^\/exercise-images\/(?:everkinetic-\d{4}-(?:relaxation|tension)|workout-guide-machine-lateral-raise-1)\.png$/.test(image.path) || paths.has(image.path)) throw new Error('Invalid supplemental image path.');
      paths.add(image.path);
      const bytes = readAsset(image.path);
      if (bytes.length > 3000000 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error(`Supplement image integrity failed: ${image.path}`);
    }
  }
  return records.map(exercise => {
    const supplement = supplements.get(exercise.id);
    if (!supplement) return exercise;
    const supplementalPaths = new Set(supplement.images.map(image => image.path));
    return {
      ...exercise,
      images: [...exercise.images.filter(image => !supplementalPaths.has(image.path)), ...structuredClone(supplement.images)],
      ...(supplement.image_note ? { image_note: supplement.image_note } : {}),
    };
  });
}
