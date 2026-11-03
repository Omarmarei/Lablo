// Build fixture: CSS imported from modules lands in app.css in the modules' evaluation order.
// lib.ts (and its CSS) runs before this module's own CSS import below it.
import { mark } from './lib/lib';
import './app.css';

(globalThis as unknown as { fixture: unknown }).fixture = { mark };
