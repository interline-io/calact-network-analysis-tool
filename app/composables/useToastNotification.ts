// TODO: Replace with catenary toast component when available
export type ToastVariant = 'primary' | 'info' | 'success' | 'warning' | 'danger'

export const useToastNotification = () => {
  if (import.meta.server) {
    return {
      showToast: (message: string, _variant?: ToastVariant) => {
        console.warn('[useToastNotification] Attempted to show toast during SSR:', message)
      }
    }
  }

  // The container is a persistent polite live region: screen readers only
  // announce additions to a live region that already exists, so it is created
  // once (ideally before the first toast) and never removed.
  const ensureContainer = (): HTMLElement => {
    let container = document.getElementById('toast-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'toast-container'
      container.setAttribute('aria-live', 'polite')
      // z-index must exceed `.cat-modal { z-index: 99999 !important }` in
      // app/assets/main.scss so toasts surface above an open modal.
      container.style.cssText = `
        position: fixed;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000000;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        pointer-events: none;
        width: auto;
        max-width: 90vw;
      `
      document.body.appendChild(container)
    }
    return container
  }
  ensureContainer()

  const showToast = (message: string, variant: ToastVariant = 'primary', duration: number = 3000) => {
    const container = ensureContainer()

    const toast = document.createElement('div')
    toast.className = `notification toast is-${variant}`
    toast.style.cssText = `
      pointer-events: auto;
      min-width: 250px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
    `
    toast.textContent = message
    if (variant === 'danger') {
      // Errors must interrupt: role=alert announces reliably on insertion.
      // The polite container may re-announce it in some screen readers; an
      // extra announcement is preferable to a missed error.
      toast.setAttribute('role', 'alert')
    }
    container.appendChild(toast)

    requestAnimationFrame(() => {
      toast.style.opacity = '1'
      toast.style.transform = 'translateY(0)'
    })

    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(-20px)'
      setTimeout(() => {
        // The container deliberately stays in the DOM: removing an empty live
        // region and recreating it with the next toast makes screen readers
        // miss the announcement.
        toast.remove()
      }, 300)
    }, duration)
  }

  return { showToast }
}
