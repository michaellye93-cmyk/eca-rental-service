import { useId, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface PickOption {
  id: string;
  label: string;
}

interface SearchPickProps {
  id: string;
  options: PickOption[];
  /** The chosen option's id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}

/** Ignores letter case and spaces, so "xaa1001" finds "XAA 1001". */
const squash = (text: string) => text.toLowerCase().replace(/\s+/g, '');

/** A search box that drops down the matching options; type part of a plate, name or model, then pick one. */
export default function SearchPick({ id, options, value, onChange, placeholder }: SearchPickProps) {
  const chosen = options.find(option => option.id === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = options.filter(option => !query.trim() || squash(option.label).includes(squash(query))).slice(0, 50);

  const pick = (option: PickOption) => {
    onChange(option.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full border border-gray-300 rounded p-2 pl-8 pr-8 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        placeholder={chosen ? chosen.label : placeholder}
        value={open ? query : chosen?.label ?? ''}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => setOpen(false)}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, shown.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          if (event.key === 'Enter' && open && shown[active]) { event.preventDefault(); pick(shown[active]); }
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {chosen && !open && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear" title="Clear"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 rounded">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm">
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-gray-500">No match</li>
          ) : shown.map((option, index) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              // mousedown, not click, so the pick happens before the box loses focus and closes
              onMouseDown={event => { event.preventDefault(); pick(option); }}
              onMouseEnter={() => setActive(index)}
              className={`px-3 py-2 cursor-pointer ${index === active ? 'bg-blue-50 text-blue-800' : 'text-gray-800'} ${option.id === value ? 'font-semibold' : ''}`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
