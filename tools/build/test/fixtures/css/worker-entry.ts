// Build fixture: imports a worker that imports CSS, which the build refuses.
import CssWorker from './css.worker?worker';

(globalThis as unknown as { fixture: unknown }).fixture = { start: () => new CssWorker() };
