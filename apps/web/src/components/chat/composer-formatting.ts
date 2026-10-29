export interface FormattingResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Apply markdown/WhatsApp formatting (bold *, italic _, strike ~, code `) to text in a composer.
 * If text is selected:
 *   - Wraps the selection with the delimiter.
 *   - If already wrapped (inside the selection or immediately outside), unwraps it.
 * If no text is selected:
 *   - Inserts the delimiter pair and places the cursor in the middle.
 */
export function formatComposerText(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  delimiter: string,
): FormattingResult {
  const delimLen = delimiter.length;

  // Selection is non-empty
  if (selectionStart !== selectionEnd) {
    const selected = text.slice(selectionStart, selectionEnd);

    // 1. Check if selection itself starts and ends with delimiter
    if (
      selected.startsWith(delimiter) &&
      selected.endsWith(delimiter) &&
      selected.length >= delimLen * 2
    ) {
      const unwrapped = selected.slice(delimLen, -delimLen);
      const newText =
        text.slice(0, selectionStart) + unwrapped + text.slice(selectionEnd);
      return {
        text: newText,
        selectionStart,
        selectionEnd: selectionStart + unwrapped.length,
      };
    }

    // 2. Check if text immediately outside selection has the delimiter
    if (
      selectionStart >= delimLen &&
      text.slice(selectionStart - delimLen, selectionStart) === delimiter &&
      text.slice(selectionEnd, selectionEnd + delimLen) === delimiter
    ) {
      const newText =
        text.slice(0, selectionStart - delimLen) +
        selected +
        text.slice(selectionEnd + delimLen);
      return {
        text: newText,
        selectionStart: selectionStart - delimLen,
        selectionEnd: selectionStart - delimLen + selected.length,
      };
    }

    // 3. Otherwise wrap selection
    const wrapped = `${delimiter}${selected}${delimiter}`;
    const newText =
      text.slice(0, selectionStart) + wrapped + text.slice(selectionEnd);
    return {
      text: newText,
      selectionStart,
      selectionEnd: selectionStart + wrapped.length,
    };
  }

  // Collapsed cursor: insert pair and place cursor between
  const newText =
    text.slice(0, selectionStart) +
    `${delimiter}${delimiter}` +
    text.slice(selectionEnd);
  return {
    text: newText,
    selectionStart: selectionStart + delimLen,
    selectionEnd: selectionStart + delimLen,
  };
}
