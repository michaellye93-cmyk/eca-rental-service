import React, { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { portalText, type PortalLang } from '../services/portalText';
import { installPrompt, onInstallPrompt, runInstallPrompt, type InstallPromptEvent } from '../services/installPrompt';

const DISMISSED_KEY = 'eca.installTipDismissed';

const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const wasDismissed = () => {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
};

/**
 * A small card suggesting the driver add the page to their home screen, so it opens like an app. Android Chrome gets
 * an Add button; iPhone gets the Share steps; other browsers get the menu steps. Hidden once installed or dismissed.
 */
const InstallTip: React.FC<{ lang: PortalLang }> = ({ lang }) => {
  const t = portalText(lang);
  const [hidden, setHidden] = useState(() => isInstalled() || wasDismissed());
  // Caught at page load (services/installPrompt), since Chrome offers it only once
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(installPrompt);

  useEffect(() => onInstallPrompt(event => {
    setPrompt(event);
    if (!event) setHidden(true); // installed
  }), []);

  if (hidden) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* shows again next visit */ }
    setHidden(true);
  };
  const install = async () => {
    const accepted = await runInstallPrompt();
    setPrompt(null);
    if (accepted) setHidden(true);
  };

  return (
    <aside aria-label={t.installTitle} className="portal-enter bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3" style={{ animationDelay: '600ms' }}>
      <Smartphone className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-blue-950">{t.installTitle}</p>
        <p className="text-xs text-blue-900 mt-0.5">{prompt ? t.installAndroid : isIos() ? t.installIos : t.installMenu}</p>
        <div className="mt-2 flex gap-3">
          {prompt && (
            <button type="button" onClick={() => void install()} className="bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-transform active:scale-95">
              {t.installAction}
            </button>
          )}
          <button type="button" onClick={dismiss} className="text-xs font-medium text-blue-900 underline">{t.notNow}</button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label={t.notNow} className="text-blue-700 p-1 -m-1 shrink-0">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </aside>
  );
};

export default InstallTip;
