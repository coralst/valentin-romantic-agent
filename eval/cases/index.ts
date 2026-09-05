/** The whole corpus, in the order it is cheapest to run. */
import { dateCases } from './dates';
import type { EvalCase } from '../harness/assertions';

export const allCases: readonly EvalCase[] = [...dateCases];
