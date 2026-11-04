/**
 * The player's stage (RELAY step 20a): the layer under the app's screens where the engines put
 * their picture (Html5Engine's `<video>`, AVPlay's `<object>`). The app makes it on the first
 * play, as the body's first child; player.css keeps it hidden unless the player shows.
 */
export function createStage(doc: Document): HTMLElement {
  const known = doc.getElementById('stage');
  if (known !== null) return known;
  const stage = doc.createElement('div');
  stage.id = 'stage';
  stage.className = 'player-stage';
  stage.setAttribute('data-testid', 'stage');
  doc.body.insertBefore(stage, doc.body.firstChild);
  return stage;
}

/**
 * The player route on or off. `html[data-player='on']` makes `html` and `body` transparent and
 * shows the stage: AVPlay paints below the whole page on Tizen.
 */
export function setPlayerChrome(doc: Document, on: boolean): void {
  doc.documentElement.setAttribute('data-player', on ? 'on' : 'off');
}
