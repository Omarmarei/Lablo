/**
 * The scheduled refreshes, held while something needs the refresh slot to itself (RELAY step 50b):
 * a source's removal and a login's refresh (`quiet`), an add on the TV or from the phone (`hold`
 * while it loads), a restore. Holds nest: the refreshes start again only when the last holder lets
 * go. Before, one on/off switch let the first holder to finish start them again: a removal still
 * waiting for the slot then saw a new scheduled refresh take it, and waited it out ("Removing…" for
 * a whole refresh that nobody cancelled), where the hold had cancelled the one before.
 */

export interface RefreshHoldOptions {
  /** Stops the scheduled refreshes, cancelling one they run. */
  stop(): void;
  /** Starts them again (main checks its gate there). */
  start(): void;
  /** Resolves once no refresh holds the slot. */
  slotFree(): Promise<void>;
}

export interface RefreshHold {
  /** `true` holds the refreshes, `false` lets go of one hold (an add's `busy`); a `false` with no hold does nothing. */
  hold(on: boolean): void;
  /** Runs `job` with the refreshes held and the slot free, then lets go, whatever the job did. */
  quiet<T>(job: () => Promise<T>): Promise<T>;
  /** How many hold them now (main's gate starts no refreshes under a hold). */
  holders(): number;
}

export function createRefreshHold(options: RefreshHoldOptions): RefreshHold {
  let holders = 0;
  const hold = (on: boolean): void => {
    if (on) {
      holders += 1;
      if (holders === 1) options.stop();
      return;
    }
    if (holders === 0) return;
    holders -= 1;
    if (holders === 0) options.start();
  };
  return {
    hold,
    quiet<T>(job: () => Promise<T>): Promise<T> {
      hold(true);
      return options
        .slotFree()
        .then(job)
        .then(
          (value) => {
            hold(false);
            return value;
          },
          (error: unknown) => {
            hold(false);
            throw error;
          },
        );
    },
    holders: () => holders,
  };
}
