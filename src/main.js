import './styles.css';
import { App } from './app.js';
import { buildUI } from './ui/panels.js';
import { Interactions } from './editor/interactions.js';

const app = new App();
// The UI creates the #canvas container, so build it before the renderer.
buildUI(app);
app.attachViewport(document.getElementById('canvas'));
new Interactions(app);
window.quadforge = app;

// Start with something to look at, but never block first paint.
requestAnimationFrame(() => {
  try {
    const saved = app.loadLocal();
    if (!saved) {
      app.addCharacter({ height: 1.8, build: 0.45, muscle: 0.55, hair: true, armor: false });
      app.objects[0].transform.position = [0, 0, 0];
      app.selection.clear();
      app.history.length = 0;
      app.refresh();
      app.viewport.frameAll(app.objects);
    }
  } catch (e) {
    console.warn('startup scene failed', e);
  }
});

// Autosave on inactivity, so a refresh never loses work.
let saveTimer = null;
app.on('objects', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => app.saveLocal(), 1200);
});

// Surface renderer failures instead of a blank canvas.
const canvas = document.getElementById('canvas');
if (!canvas.querySelector('canvas')) {
  const note = document.createElement('div');
  note.className = 'gl-error';
  note.innerHTML = '<strong>无法初始化 WebGL</strong><p>请确认浏览器已启用硬件加速。</p>';
  canvas.append(note);
}
