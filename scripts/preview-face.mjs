/**
 * Render the face texture to a PNG so it can be reviewed without a browser.
 * Dev-only; not part of the shipped bundle.
 *
 *   node scripts/preview-face.mjs out.png [palette]
 */
import fs from 'node:fs';
import { createCanvas, Path2D as NPath2D } from '@napi-rs/canvas';
import { paintFace, FACE_PALETTES, FACE_CANVAS_SIZE } from '../src/editor/faceTexture.js';

globalThis.Path2D = NPath2D;

const out = process.argv[2] || 'face-preview.png';
const paletteName = process.argv[3] || 'default';
const { W, H } = FACE_CANVAS_SIZE;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

paintFace(ctx, FACE_PALETTES[paletteName] || FACE_PALETTES.default, { skin: '#f8e0cf' });

fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`wrote ${out} (${W}x${H}, palette ${paletteName})`);
