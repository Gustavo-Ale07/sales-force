import { useEffect, useState } from "react";
import type { ConnectivityPort, ConnectivityState } from "./connectivity";

/** Current connectivity state; `unknown` until the first reading. */
export function useConnectivity(port: ConnectivityPort): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>("unknown");

  useEffect(() => {
    let active = true;
    const unsubscribe = port.subscribe((next) => {
      if (active) setState(next);
    });
    port
      .getState()
      .then((initial) => {
        if (active) setState(initial);
      })
      .catch(() => {
        // The subscription keeps working; "unknown" is the honest answer until it reports.
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [port]);

  return state;
}
