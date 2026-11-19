/**
 * Stage non-bundled assets into dist/ after `vite build`.
 *
 * The app fetches /examples/*.quadforge.json at runtime, but those files live
 * outside Vite's `public/` directory, so `vite build` does not copy them and
 * the deployed bundle 404s on every example. Doing this in the build script
 * (rather than in the Dockerfile) means `npm run build`, the CI job and the
 * image all produce the same tree — there is one definition of "the bundle".
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const examplesSrc = path.join(root, 'examples');
const examplesOut = path.join(dist, 'examples');

if (!fs.existsSync(dist)) {
  console.error('stage: dist/ does not exist — run vite build first');
  process.exit(1);
}

fs.mkdirSync(examplesOut, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(examplesSrc)) {
  if (!name.endsWith('.quadforge.json')) continue;
  fs.copyFileSync(path.join(examplesSrc, name), path.join(examplesOut, name));
  n++;
}
console.log(`stage: copied ${n} example document(s) into dist/examples/`);
