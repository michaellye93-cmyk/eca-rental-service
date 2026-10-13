import React from 'react';
import type { Driver } from '../../types';
import { formatPhone, kualaLumpurNow } from '../../utils';

/** The contact details' sort: by name or category, ascending or descending, or none (the list's own order). */
export type DetailsSort = { key: 'CATEGORY' | 'NAME' | null; direction: 'asc' | 'desc' | null };

interface ContactDetailsTableProps<T extends Driver> {
  /** The filtered drivers, in the list's order. */
  rows: T[];
  sortConfig: DetailsSort;
  onSortConfigChange: React.Dispatch<React.SetStateAction<DetailsSort>>;
  onEdit: (driver: T) => void;
}

/** Contact-details order: by name or category when chosen, otherwise the list's own order. */
function sortForDetails<T extends Driver>(rows: T[], config: { key: 'CATEGORY' | 'NAME' | null; direction: 'asc' | 'desc' | null }): T[] {
  if (!config.key || !config.direction) return rows;
  const value = (d: T) => (config.key === 'CATEGORY' ? d.category || '' : (d.name || '').toLowerCase());
  return [...rows].sort((a, b) => {
    const A = value(a);
    const B = value(b);
    if (A < B) return config.direction === 'asc' ? -1 : 1;
    if (A > B) return config.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

/** Contact details (admins): name, email, phone, WhatsApp group, address, NRIC, plate and category, with Edit. */
export default function ContactDetailsTable<T extends Driver>({ rows, sortConfig, onSortConfigChange, onEdit }: ContactDetailsTableProps<T>) {
  const driverListSortConfig = sortConfig;
  const detailsRows = sortForDetails(rows, driverListSortConfig);
  const sortArrow = (key: 'NAME' | 'CATEGORY') =>
    driverListSortConfig.key === key && driverListSortConfig.direction === 'asc' ? '▲' : driverListSortConfig.key === key && driverListSortConfig.direction === 'desc' ? '▼' : '↕';
  const cycleDetailsSort = (key: 'NAME' | 'CATEGORY') => onSortConfigChange(prev => ({
    key,
    direction: prev.key === key ? (prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc') : 'asc'
  }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
          <tr>
            <th className="px-6 py-3 group select-none">
              <button type="button" className="flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-gray-800" onClick={() => cycleDetailsSort('NAME')}>
                Full Name <span aria-hidden="true" className={driverListSortConfig.key === 'NAME' && driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}>{sortArrow('NAME')}</span>
              </button>
            </th>
            <th className="px-6 py-3">Email Address</th>
            <th className="px-6 py-3">Phone</th>
            <th className="px-6 py-3">WhatsApp group</th>
            <th className="px-6 py-3">Address</th>
            <th className="px-6 py-3">NRIC</th>
            <th className="px-6 py-3">Plate Number</th>
            <th className="px-6 py-3 group select-none">
              <button type="button" className="flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-gray-800" onClick={() => cycleDetailsSort('CATEGORY')}>
                Category <span aria-hidden="true" className={driverListSortConfig.key === 'CATEGORY' && driverListSortConfig.direction ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}>{sortArrow('CATEGORY')}</span>
              </button>
            </th>
            <th className="px-6 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {detailsRows.map(driver => {
            let isNew = false;
            if (driver.contractStartDate) {
              const start = new Date(driver.contractStartDate + 'T00:00:00');
              const diffDays = Math.ceil(Math.abs(kualaLumpurNow().getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
              isNew = diffDays <= 30;
            }
            return (
              <tr key={driver.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-bold text-gray-900">
                  <span className="flex items-center gap-2">
                    {driver.name}
                    {isNew && <span className="text-xs text-red-700 font-black tracking-widest border border-red-500/30 px-1.5 py-0.5 rounded-sm bg-red-50">NEW</span>}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-600 truncate max-w-[150px]" title={driver.email || ''}>{driver.email || '-'}</td>
                <td className="px-6 py-4 text-gray-600 whitespace-nowrap font-mono">{driver.phone ? formatPhone(driver.phone) : '-'}</td>
                <td className="px-6 py-4 text-gray-600 whitespace-nowrap">{driver.whatsappGroup || '-'}</td>
                <td className="px-6 py-4 text-gray-600 truncate max-w-[200px]" title={driver.address || ''}>{driver.address || '-'}</td>
                <td className="px-6 py-4 text-gray-600">{driver.nric}</td>
                <td className="px-6 py-4 text-gray-700 font-mono">{driver.carPlate}</td>
                <td className="px-6 py-4 text-gray-600">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    driver.category === 'SEWABELI' ? 'bg-blue-100 text-blue-800' :
                    driver.category === 'SEWA_BIASA' ? 'bg-purple-100 text-purple-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {driver.category}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button type="button" onClick={() => onEdit(driver)} className="text-xs text-blue-700 font-semibold hover:bg-blue-50 px-3 py-1.5 rounded transition-colors border border-blue-100 bg-white shadow-sm">
                    Edit Details
                  </button>
                </td>
              </tr>
            );
          })}
          {detailsRows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-6 py-8 text-center text-gray-500">No drivers match these filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
