// These IDs only correlate frontend requests with backend replies. Unlike
// randomUUID(), getRandomValues() is available on ordinary LAN HTTP origins.
export function createRequestId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function copyText(text: string, container: HTMLElement): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* Try the HTTP-compatible path. */ }
  }
  const focus = document.activeElement as HTMLElement | null
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.setAttribute('aria-label', 'Image link')
  field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none'
  // Keep it inside the drawer dialog so its focus trap does not steal selection.
  container.append(field)
  try {
    field.focus({ preventScroll: true }); field.select(); field.setSelectionRange(0, text.length)
    return document.execCommand?.('copy') === true
  } catch { return false }
  finally { field.remove(); focus?.focus({ preventScroll: true }) }
}
