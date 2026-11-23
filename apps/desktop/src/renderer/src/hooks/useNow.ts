import { useEffect, useState } from 'react';

/** Data e ora correnti, aggiornate a intervalli: per "oggi/ieri", scadenze e conti alla rovescia. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
