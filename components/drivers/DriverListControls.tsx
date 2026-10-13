import React from 'react';
import { ChevronDown, Filter, Search } from 'lucide-react';

export type DriverScope = 'ACTIVE' | 'DELISTED' | 'TERMINATION';

interface DriverListControlsProps {
  userRole: 'admin' | 'staff';
  driverScope: DriverScope;
  onDriverScopeChange: (scope: DriverScope) => void;
  /** Drivers in each scope (the termination review's count is for admins). */
  counts: { active: number; delisted: number; termination: number };
  /** The search box, so the fleet size tile can put the keyboard there. */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  selectedTagFilter: string;
  onTagFilterChange: (tag: string) => void;
  allTags: string[];
  /** Contact details (admins) instead of the collections list. */
  showDetails: boolean;
  onListViewChange: (view: 'COLLECTIONS' | 'DETAILS') => void;
  filtersActive: boolean;
  /** Drivers shown after the filters, and in the scope before them. */
  shownCount: number;
  scopeCount: number;
  statusFilter: 'ALL' | 'GOOD' | 'MID' | 'BAD';
  onResetFilters: () => void;
}

/** The driver list's controls: which drivers, search, staff group, list view, and the active filters with a reset. */
export default function DriverListControls({
  userRole, driverScope, onDriverScopeChange, counts, searchInputRef, searchTerm, onSearchTermChange, selectedTagFilter,
  onTagFilterChange, allTags, showDetails, onListViewChange, filtersActive, shownCount, scopeCount, statusFilter, onResetFilters,
}: DriverListControlsProps) {
  return (
    <div className="lg:sticky lg:top-0 lg:z-10 bg-white border-b border-gray-200 print:hidden">
      <div className="px-3 sm:px-4 py-3 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div role="group" aria-label="Which drivers" className="flex flex-wrap bg-gray-100 p-1 rounded-lg shrink-0">
          {([['ACTIVE', 'Active', counts.active], ['DELISTED', 'Delisted / Returned', counts.delisted], ...(userRole === 'admin' ? [['TERMINATION', 'Termination review', counts.termination] as const] : [])] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={driverScope === id}
              onClick={() => onDriverScopeChange(id)}
              className={`flex-1 lg:flex-none px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${driverScope === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {label} <span className="text-gray-500">{count}</span>
            </button>
          ))}
        </div>

        {driverScope !== 'TERMINATION' && <>
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search drivers by name, car plate or NRIC"
            placeholder="Search driver, car plate, NRIC..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm focus:outline-none placeholder-gray-400"
            value={searchTerm}
            onChange={(e) => onSearchTermChange(e.target.value)}
          />
        </div>

        <div className="relative lg:w-52 shrink-0">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <select
            aria-label="Staff group"
            className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white appearance-none cursor-pointer font-medium text-gray-700"
            value={selectedTagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
          >
            <option value="ALL">All Staff Groups</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
        </div>

        {userRole === 'admin' && (
          <div role="group" aria-label="List view" className="flex bg-gray-100 p-1 rounded-lg shrink-0">
            <button type="button" aria-pressed={!showDetails} onClick={() => onListViewChange('COLLECTIONS')} className={`flex-1 lg:flex-none px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${!showDetails ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Collections</button>
            <button type="button" aria-pressed={showDetails} onClick={() => onListViewChange('DETAILS')} className={`flex-1 lg:flex-none px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${showDetails ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Contact details</button>
          </div>
        )}
        </>}
      </div>

      {filtersActive && driverScope !== 'TERMINATION' && (
        <div className="px-3 sm:px-4 py-2 bg-blue-50 border-t border-blue-100 flex flex-wrap items-center gap-2 text-xs text-blue-900">
          <span className="font-semibold">Showing {shownCount} of {scopeCount}:</span>
          {statusFilter !== 'ALL' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Risk: {statusFilter}</span>}
          {selectedTagFilter !== 'ALL' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Staff: {selectedTagFilter}</span>}
          {searchTerm !== '' && <span className="bg-white border border-blue-200 px-2 py-0.5 rounded-full font-bold">Search: “{searchTerm}”</span>}
          <button type="button" onClick={onResetFilters} className="ml-auto bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg">Reset filters</button>
        </div>
      )}
    </div>
  );
}
