/**
 * HTML utilities for safely handling user-provided content
 */

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
