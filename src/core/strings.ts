export function capitalize (s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

// Text made safe to put in HTML.
export function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] || c))
}
