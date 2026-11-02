/**
 * Mejora progresiva (todo funciona sin JS; esto solo evita recargas):
 *
 * - `form[data-enhance="toggle"]`: palomear artículos de la lista al instante. Se cambia la UI
 *   de inmediato y se envía en segundo plano; si falla, se revierte y se envía el formulario normal.
 * - `[data-copy="#selector"]`: copia el texto de un campo.
 * - `[data-share="#selector"]`: abre el menú de compartir del teléfono (Web Share API).
 */

function updateProgress() {
  let total = document.querySelectorAll('[data-item]').length
  let done = document.querySelectorAll('[data-item].checked').length
  let progress = document.querySelector<HTMLElement>('[data-progress]')
  if (!progress) return
  let doneEl = progress.querySelector('[data-done]')
  if (doneEl) doneEl.textContent = String(done)
  let bar = progress.querySelector('progress')
  if (bar) {
    bar.max = Math.max(total, 1)
    bar.value = done
  }
}

function setToggleState(form: HTMLFormElement, checked: boolean) {
  let item = form.closest<HTMLElement>('[data-item]')
  item?.classList.toggle('checked', checked)
  let hidden = form.querySelector<HTMLInputElement>('input[name="checked"]')
  if (hidden) hidden.value = checked ? '0' : '1'
  let button = form.querySelector('button')
  button?.setAttribute('aria-pressed', checked ? 'true' : 'false')
  updateProgress()
}

async function submitToggle(form: HTMLFormElement) {
  let hidden = form.querySelector<HTMLInputElement>('input[name="checked"]')
  let nextChecked = hidden?.value === '1'
  let body = new FormData(form)
  setToggleState(form, nextChecked)
  try {
    let response = await fetch(form.action, {
      method: 'POST',
      body,
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(String(response.status))
  } catch {
    setToggleState(form, !nextChecked)
    form.dataset.enhance = 'off'
    form.submit()
  }
}

/**
 * Todo va delegado en `document` y la visibilidad depende de clases en <html>, porque el runtime
 * navega sin recargar la página: lo que se pinta después de una navegación también funciona.
 */
export function enhance() {
  let root = document.documentElement
  let flags = [navigator.clipboard ? 'can-copy' : '', typeof navigator.share === 'function' ? 'can-share' : ''].filter(Boolean)
  let applyFlags = () => {
    if (flags.some((f) => !root.classList.contains(f))) root.classList.add(...flags)
  }
  applyFlags()
  // El runtime vuelve a poner los atributos de <html> del servidor al navegar: re-aplicamos.
  if (flags.length) new MutationObserver(applyFlags).observe(root, { attributes: true, attributeFilter: ['class'] })

  document.addEventListener('submit', (event) => {
    let form = event.target
    if (!(form instanceof HTMLFormElement) || form.dataset.enhance !== 'toggle') return
    event.preventDefault()
    void submitToggle(form)
  })

  document.addEventListener('click', (event) => {
    let target = event.target instanceof Element ? event.target : null
    let copy = target?.closest<HTMLButtonElement>('[data-copy]')
    if (copy && navigator.clipboard) {
      let field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(copy.dataset.copy!)
      if (!field) return
      void navigator.clipboard.writeText(field.value).then(() => {
        let label = copy.dataset.label ?? copy.textContent ?? 'Copiar'
        copy.dataset.label = label
        copy.textContent = '¡Copiado!'
        setTimeout(() => (copy.textContent = label), 1500)
      })
      return
    }
    let share = target?.closest<HTMLButtonElement>('[data-share]')
    if (share && typeof navigator.share === 'function') {
      let field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(share.dataset.share!)
      if (!field) return
      navigator.share({ title: share.dataset.shareTitle, text: field.value }).catch(() => {})
    }
  })
}
