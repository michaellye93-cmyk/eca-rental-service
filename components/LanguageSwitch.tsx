import React from 'react';
import { PORTAL_LANGS, type PortalLang } from '../services/portalText';

/** EN · BM · 中文 switch for the driver page and the driver login. */
const LanguageSwitch: React.FC<{ lang: PortalLang; onChange: (lang: PortalLang) => void; label: string }> = ({ lang, onChange, label }) => (
  <div role="group" aria-label={label} className="inline-flex rounded-full bg-gray-100 p-0.5">
    {PORTAL_LANGS.map(option => (
      <button
        key={option.code}
        type="button"
        lang={option.code}
        aria-pressed={lang === option.code}
        onClick={() => onChange(option.code)}
        className={`px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200 active:scale-95 ${
          lang === option.code ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export default LanguageSwitch;
