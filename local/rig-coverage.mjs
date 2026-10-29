import { readFile } from 'node:fs/promises';
import { FIXED_STEREO_RIG } from '../pointcloud/stereo-rig.mjs';
import { checkFixedPair } from './stereo-check.mjs';

// Runs the app's own rectification and matcher on raw working-size RGBA pairs written by fit_rig.py.
// Input JSON: {width, height, pairs: [[left.rgba, right.rgba], ...], profiles: {name: {left, right}}}.
const job = JSON.parse(await readFile(process.argv[2], 'utf8'));
const image = async path => ({ width: job.width, height: job.height, data: new Uint8ClampedArray(await readFile(path)) });
const result = {};
for (const [name, rows] of Object.entries(job.profiles)) {
  const profile = { ...FIXED_STEREO_RIG, ...rows };
  result[name] = [];
  for (const [left, right] of job.pairs) {
    const check = checkFixedPair(await image(left), await image(right), { profile, range: job.range ?? 40, step: 2 });
    result[name].push({ atProfile: check.atProfile, best: check.best });
  }
}
console.log(JSON.stringify(result));
