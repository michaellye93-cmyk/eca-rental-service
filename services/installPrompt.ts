/**
 * Chrome's "install this app" event fires once, soon after the page loads, often before the driver has signed in.
 * This file is loaded first (index.tsx) so the event is caught then and the driver page can offer an Add button later.
 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let saved: InstallPromptEvent | null = null;
const listeners = new Set<(event: InstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    saved = event as InstallPromptEvent;
    listeners.forEach(listener => listener(saved));
  });
  window.addEventListener('appinstalled', () => {
    saved = null;
    listeners.forEach(listener => listener(null));
  });
}

/** The caught install event, if the browser offered one. */
export const installPrompt = () => saved;
/** Calls back when the browser offers (or withdraws) the install event; returns the unsubscribe. */
export const onInstallPrompt = (listener: (event: InstallPromptEvent | null) => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
/** Shows the browser's install dialog once; true when the driver accepted. */
export const runInstallPrompt = async (): Promise<boolean> => {
  const event = saved;
  if (!event) return false;
  saved = null;
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
};
