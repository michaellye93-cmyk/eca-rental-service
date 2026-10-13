import { useEffect, useState } from 'react';
import { kualaLumpurToday } from '../../utils';
import { loadScreenedDriverIds, markScreened } from '../../services/screening';

/**
 * Daily screening, shared between staff (Kuala Lumpur calendar day): today's marks from every member of staff, a new
 * list at Kuala Lumpur midnight, and other staff's marks again when this tab comes back into view. `screeningDate`
 * changes at midnight, which the driver list also uses to work its figures out again overnight.
 */
export function useScreening() {
  const [screenedDriverIds, setScreenedDriverIds] = useState<string[]>([]);
  const [screeningDate, setScreeningDate] = useState<string>(() => kualaLumpurToday());
  // False when the shared screening table is not available yet: marks then last only while this page is open
  const [screeningShared, setScreeningShared] = useState(true);
  const [screeningReload, setScreeningReload] = useState(0);

  // Today's marks from every member of staff
  useEffect(() => {
    let live = true;
    loadScreenedDriverIds(screeningDate)
      .then(ids => {
        if (!live) return;
        setScreeningShared(true);
        setScreenedDriverIds(previous => [...new Set([...ids, ...previous.filter(id => !ids.includes(id))])]);
      })
      .catch(() => { if (live) setScreeningShared(false); });
    return () => { live = false; };
  }, [screeningDate, screeningReload]);

  // A new list at Kuala Lumpur midnight, and other staff's marks when this tab comes back into view
  useEffect(() => {
    const interval = setInterval(() => {
      const today = kualaLumpurToday();
      if (today !== screeningDate) {
        setScreenedDriverIds([]);
        setScreeningDate(today);
      }
    }, 10000);
    const reloadWhenVisible = () => { if (document.visibilityState === 'visible') setScreeningReload(n => n + 1); };
    document.addEventListener('visibilitychange', reloadWhenVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', reloadWhenVisible);
    };
  }, [screeningDate]);

  const handleScreenDriver = (driverId: string) => {
    if (screenedDriverIds.includes(driverId)) return;
    setScreenedDriverIds(previous => (previous.includes(driverId) ? previous : [...previous, driverId]));
    markScreened(driverId, screeningDate).catch(() => setScreeningShared(false));
  };

  return { screenedDriverIds, screeningDate, screeningShared, handleScreenDriver };
}
