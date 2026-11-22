/**
 * Parental control's icons (RELAY step 38b), ours, drawn in the text's colour: a closed lock (the
 * rails' "Locked groups" and "Lock again") and an open one (a locked group shown in an unlocked
 * session).
 */

export const LOCK_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </g>
  </svg>
);

export const OPEN_LOCK_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.8" />
    </g>
  </svg>
);

/** The lock on a rail entry's chip (step 38b): closed on the last entry, open on a locked group shown unlocked; none else. */
export function railIcon(entry: { readonly kind: string; readonly opened?: true }) {
  if (entry.kind === 'locked') return LOCK_ICON;
  return entry.opened === true ? OPEN_LOCK_ICON : undefined;
}
