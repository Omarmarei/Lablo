// Build fixture: the __PLATFORM__ define must remove the other platform's module entirely.
import { tizenOnly } from './tizen-only';
import { webosOnly } from './webos-only';

declare const __PLATFORM__: string;

(globalThis as unknown as { fixture: unknown }).fixture = __PLATFORM__ === 'tizen' ? tizenOnly() : webosOnly();
