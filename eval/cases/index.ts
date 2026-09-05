/**
 * The whole corpus, cheapest group first.
 *
 * Order matters under a turn budget: a run that exhausts the budget on six-turn
 * consistency cases never reaches the single-turn date cases, which are where the
 * reported bugs are. So single-turn groups run first.
 */
import { consistencyCases } from './consistency';
import { dateCases } from './dates';
import { playlistCases } from './playlist';
import { robustnessCases } from './robustness';
import type { EvalCase } from '../harness/assertions';

export const allCases: readonly EvalCase[] = [
  ...dateCases,
  ...playlistCases,
  ...robustnessCases,
  ...consistencyCases,
];
