import { Type } from 'typebox';
import { registerLife } from '../../extension.mjs';

export default function (pi) {
  if (!process.env.PI_LIFE_TEST_WORKSPACE) throw new Error('Missing fictional test workspace');
  registerLife(pi, Type, { workspace: process.env.PI_LIFE_TEST_WORKSPACE });
}
