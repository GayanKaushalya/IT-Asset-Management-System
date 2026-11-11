/** Earliest date allowed in any ITAMS date picker (year list includes 2015). */
export const DATE_INPUT_MIN = '2015-01-01';

/**
 * Ensure every `input[type=date]` under `root` can go back to 2015.
 * Does not override a stricter (later) `min` already set on the field.
 */
export function ensureDateInputMins(root: ParentNode = document): void {
  root.querySelectorAll('input[type="date"]').forEach((node) => {
    const el = node as HTMLInputElement;
    const current = el.getAttribute('min');
    if (!current || current === '' || current < DATE_INPUT_MIN) {
      el.setAttribute('min', DATE_INPUT_MIN);
    }
  });
}
