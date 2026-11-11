import { useEffect } from 'react';
import { ensureDateInputMins } from '../lib/dateInput';

/**
 * Keeps every native date picker in the app able to select from 2015 onward,
 * including fields rendered later in modals / tabs.
 */
export default function DateInputMinGuard() {
  useEffect(() => {
    ensureDateInputMins(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((node) => {
            if (node instanceof HTMLInputElement && node.type === 'date') {
              ensureDateInputMins(node.parentNode ?? document);
            } else if (node instanceof Element) {
              if (node.matches?.('input[type="date"]') || node.querySelector?.('input[type="date"]')) {
                ensureDateInputMins(node);
              }
            }
          });
        } else if (m.type === 'attributes' && m.target instanceof HTMLInputElement) {
          if (m.target.type === 'date') ensureDateInputMins(m.target.parentNode ?? document);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'min'],
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
