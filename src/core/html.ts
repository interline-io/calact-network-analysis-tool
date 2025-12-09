/**
 * HTML escaping utilities for safely displaying user-provided content
 */

/**
 * Escape HTML special characters to prevent XSS attacks
 * Converts <, >, &, ", ' to their HTML entity equivalents
 * TODO: move into tlv2-ui to share
 * @param text - Text to escape
 * @returns Escaped text safe for HTML interpolation
 */
export function escapeHtml (text: string | number | undefined | null): string {
  if (text == null) return ''
  const str = String(text)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
