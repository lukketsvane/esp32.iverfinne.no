import { FIXED_STEREO_RIG, prepareFixedStereo } from '../pointcloud/stereo-rig.mjs';
import { estimateStereoVerticalShift, shiftStereoRows } from '../pointcloud/stereo-align.mjs';
import { estimateStereoDepth } from '../pointcloud/stereo.mjs';

// Measures how well a pair fits the fixed rig profile. The app itself never shifts rows; this only
// reports how far a remounted rig has drifted so the profile can be measured again.
export function checkFixedPair(left, right, { profile = FIXED_STEREO_RIG, range = 40, step = 2 } = {}) {
  if (!Number.isInteger(range) || !Number.isInteger(step) || step < 1 || range < 0 || range % step) throw new Error('Ugyldig søkjeområde.');
  const rig = prepareFixedStereo(left, right, profile);
  const coverage = offset => {
    try {
      const { valid } = estimateStereoDepth(rig.left, offset ? shiftStereoRows(rig.right, rig.width, rig.height, offset) : rig.right, rig.width, rig.height);
      return valid.reduce((sum, value) => sum + value, 0) / valid.length;
    } catch {
      return 0;
    }
  };
  const sweep = [];
  for (let offset = -range; offset <= range; offset += step) sweep.push({ offset, coverage: coverage(offset) });
  const strongest = sweep.reduce((a, b) => b.coverage > a.coverage ? b : a), best = strongest.coverage > 0 ? strongest : null;
  return {
    width: rig.width, height: rig.height, rigId: rig.rigId,
    residual: estimateStereoVerticalShift(rig.left, rig.right, rig.width, rig.height),
    atProfile: sweep.find(entry => entry.offset === 0).coverage, best, sweep,
  };
}
