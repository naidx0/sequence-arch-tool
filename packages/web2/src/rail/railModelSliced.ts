import type { GetFunctionsResponse } from '@sequence/api-types';

import { runSliced } from '../files/yieldSlice';
import type { SliceOptions } from '../files/yieldSlice';

import { buildFunctionIndexSteps } from './railModel';
import type { FunctionIndex } from '../state/types';

/** The same index as `buildFunctionIndex`, built in slices that hand the thread back (opening Files on a large repository). Kept out of railModel.ts, which must carry no runtime import. */
export function buildFunctionIndexSliced(response: GetFunctionsResponse, opts?: SliceOptions): Promise<FunctionIndex> {
  return runSliced(buildFunctionIndexSteps(response), opts);
}
