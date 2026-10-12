import { useEffect, useMemo, useState } from 'react';
import type { FinanceVehicle } from '../../types/finance';
import type { Driver } from '../../types';
import type { Car } from '../../services/fleet/rules';
import { fleet } from '../../services/fleet/client';
import { platesToCheck, type PlateToCheck } from '../../services/finance/plateCheck';

const GROUPS: { key: 'financeOnly' | 'fleetOnly' | 'driversOnNeither'; title: string; detail: string }[] = [
  { key: 'financeOnly', title: 'In Finance, not on Fleet', detail: 'Finance status' },
  { key: 'fleetOnly', title: 'On Fleet, not in Finance', detail: 'Car' },
  { key: 'driversOnNeither', title: 'Active drivers on neither', detail: 'Driver' },
];

/**
 * Records → Vehicle Master: plates that do not line up across Finance's Vehicle Master, the Fleet page and the active
 * drivers (compared without spaces or letter case). Read only; fix each plate where it is wrong.
 */
export default function PlatesToCheck({ vehicles, drivers }: { vehicles: FinanceVehicle[]; drivers: Driver[] }) {
  const [cars, setCars] = useState<Car[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fleet.listCars()
      .then((loaded) => { if (active) setCars(loaded); })
      .catch((err) => { if (active) setProblem(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, []);
  const result = useMemo(() => (cars ? platesToCheck(vehicles, cars, drivers) : null), [vehicles, cars, drivers]);
  const total = result ? GROUPS.reduce((sum, group) => sum + result[group.key].length, 0) : 0;

  return (
    <section className="finance-panel" aria-labelledby="plates-to-check-heading">
      <div className="finance-section-heading">
        <div>
          <h3 id="plates-to-check-heading">Plates to check</h3>
          <p>Plates that are not the same in Finance, on the Fleet page and on active drivers (spaces and letter case ignored). Nothing here changes any record.</p>
        </div>
      </div>
      {problem ? (
        <p className="finance-empty" role="alert">The Fleet car list can't be read: {problem}</p>
      ) : !result ? (
        <p className="finance-empty" role="status">Loading the Fleet car list…</p>
      ) : total === 0 ? (
        <p className="finance-empty">Every plate matches.</p>
      ) : (
        GROUPS.filter((group) => result[group.key].length > 0).map((group) => (
          <div key={group.key} className="finance-table-wrap">
            <table className="finance-table">
              <caption className="finance-strong" style={{ textAlign: 'left', padding: '8px 0' }}>{group.title} ({result[group.key].length})</caption>
              <thead><tr><th scope="col">Plate</th><th scope="col">{group.detail}</th></tr></thead>
              <tbody>
                {result[group.key].map((row: PlateToCheck) => (
                  <tr key={row.plate}><td className="finance-strong">{row.label}</td><td>{row.detail || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}
