/**
 * The loader at the top of a split main.js (RELAY step 35e, ADR-003's amendment of 2026-11-21).
 *
 * Chromium 53 has no `import()` (63 added it), and a second IIFE can't share main's modules (two
 * Preacts, two signals cores). So a split build is Rollup's own code splitting, written as AMD:
 * every file calls `__labloDefine(id, dependencies, factory)` (Rollup's `amd.define` and
 * `amd.autoId`), and Rollup writes each dynamic `import()` as
 * `new Promise(function (resolve, reject) { require(['./settings'], resolve, reject); })`, where
 * `require` is the loader's, given to main's factory as its `'require'` dependency.
 *
 * - **The entry** runs as soon as it is defined: main.js is the loader, then main's own define.
 * - **A lazy file** loads by a `<script>` tag (`<id>.js`, next to the page), once: a second
 *   request while it loads waits for the same tag. Its factory runs when it is first required.
 *   A tag that fails (or a file that defines nothing) rejects every waiting request, and the tag
 *   goes, so the next request loads it again.
 * - **One file per request:** a lazy file may depend only on files already defined (main). The
 *   build refuses any other shape (`checkChunks` in bundle.ts), so the loader never fetches a
 *   dependency.
 * - **One global:** `__labloDefine`. No `define` or `require` on `window`, so nothing on the
 *   page mistakes the app for an AMD loader.
 *
 * Plain ES5 (the syntax gate checks the whole main.js); terser minifies it with the chunk (it is
 * Rollup's `banner`, so it is in the chunk before `renderChunk`).
 */

/** The global the chunks call (Rollup's `output.amd.define`). */
export const DEFINE_NAME = '__labloDefine';

/** The loader for a split build whose entry chunk's id is `entry` (its file name without `.js`). */
export function amdLoaderScript(entry: string): string {
  return [
    '(function (win, doc) {',
    "  'use strict';",
    `  var ENTRY = ${JSON.stringify(entry)};`,
    '  var own = Object.prototype.hasOwnProperty;',
    '  var defined = {};',
    '  var made = {};',
    '  var loading = {};',
    "  function bare(id) { return id.slice(0, 2) === './' ? id.slice(2) : id; }",
    '  function make(id) {',
    '    if (own.call(made, id)) return made[id];',
    "    if (!own.call(defined, id)) throw new Error(id + '.js did not load');",
    '    var deps = defined[id][0];',
    '    var exports = {};',
    '    var args = [];',
    '    for (var i = 0; i < deps.length; i++) {',
    "      args.push(deps[i] === 'exports' ? exports : deps[i] === 'require' ? load : make(bare(deps[i])));",
    '    }',
    '    made[id] = exports;',
    '    try {',
    '      defined[id][1].apply(null, args);',
    '    } catch (error) {',
    '      delete made[id];',
    '      throw error;',
    '    }',
    '    return exports;',
    '  }',
    '  function run(id, ok, fail) {',
    '    var exports;',
    '    try {',
    '      exports = make(id);',
    '    } catch (error) {',
    '      fail(error);',
    '      return;',
    '    }',
    '    ok(exports);',
    '  }',
    '  function load(ids, ok, fail) {',
    '    var id = bare(ids[0]);',
    '    if (own.call(defined, id)) return run(id, ok, fail);',
    '    if (own.call(loading, id)) return void loading[id].push([ok, fail]);',
    '    loading[id] = [[ok, fail]];',
    "    var script = doc.createElement('script');",
    '    script.onload = script.onerror = function () {',
    '      script.onload = script.onerror = null;',
    '      if (script.parentNode) script.parentNode.removeChild(script);',
    '      var waiting = loading[id];',
    '      delete loading[id];',
    '      for (var i = 0; i < waiting.length; i++) run(id, waiting[i][0], waiting[i][1]);',
    '    };',
    "    script.src = id + '.js';",
    '    doc.head.appendChild(script);',
    '  }',
    `  win.${DEFINE_NAME} = function (id, deps, factory) {`,
    '    defined[id] = [deps, factory];',
    '    if (id === ENTRY) make(id);',
    '  };',
    '})(window, document);',
    '',
  ].join('\n');
}
