// Build fixture: a worker must not import CSS (no DOM).
import './app.css';

self.postMessage('css');
