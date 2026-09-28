import { useCallback, useEffect, useState } from 'react';
import { loadBankIn, loadPlans, loadPromises, type BankIn } from '../services/collectionsApi';
import type { CatchUpPlan, PaymentPromise } from '../services/collections';

export interface CollectionsExtras {
  /** False until the first load has finished. */
  loaded: boolean;
  /** Each is null when its table is not available yet (the database update has not been run) or could not be read. */
  bankIn: BankIn | null;
  promises: PaymentPromise[] | null;
  plans: CatchUpPlan[] | null;
  reload: () => Promise<void>;
}

/** The bank-in lines, promises and catch-up plans, loaded on sign-in and again when this tab comes back into view. */
export function useCollectionsExtras(): CollectionsExtras {
  const [state, setState] = useState<Omit<CollectionsExtras, 'reload'>>({ loaded: false, bankIn: null, promises: null, plans: null });
  const reload = useCallback(async () => {
    const [bankIn, promises, plans] = await Promise.allSettled([loadBankIn(), loadPromises(), loadPlans()]);
    setState({
      loaded: true,
      bankIn: bankIn.status === 'fulfilled' ? bankIn.value : null,
      promises: promises.status === 'fulfilled' ? promises.value : null,
      plans: plans.status === 'fulfilled' ? plans.value : null,
    });
  }, []);
  useEffect(() => {
    void reload();
    const whenVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', whenVisible);
    return () => document.removeEventListener('visibilitychange', whenVisible);
  }, [reload]);
  return { ...state, reload };
}
