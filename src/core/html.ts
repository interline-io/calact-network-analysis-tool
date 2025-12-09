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

/**
 * Validate and sanitize URLs for safe use in href attributes
 * Only allows http:// and https:// protocols to prevent javascript: or data: URL attacks
 * @param url - URL to validate
 * @returns Sanitized URL if safe, empty string if unsafe or invalid
 */
export function sanitizeUrl (url: string | undefined | null): string {
  if (!url) return ''
  const trimmed = url.trim()
  if (!trimmed) return ''

  // Check for safe protocols (http:// or https://)
  // Case-insensitive check for protocol
  const lowerUrl = trimmed.toLowerCase()
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return trimmed
  }

  // Reject javascript:, data:, vbscript:, and other dangerous protocols
  // Return empty string for unsafe URLs
  return ''
}
