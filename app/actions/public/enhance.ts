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

export function enhance() {
  document.addEventListener('submit', (event) => {
    let form = event.target
    if (!(form instanceof HTMLFormElement) || form.dataset.enhance !== 'toggle') return
    event.preventDefault()
    void submitToggle(form)
  })

  for (let button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    if (!navigator.clipboard) continue
    button.hidden = false
    button.addEventListener('click', async () => {
      let field = document.querySelector<HTMLTextAreaElement>(button.dataset.copy!)
      if (!field) return
      await navigator.clipboard.writeText(field.value)
      let label = button.textContent
      button.textContent = '¡Copiado!'
      setTimeout(() => (button.textContent = label), 1500)
    })
  }

  for (let button of document.querySelectorAll<HTMLButtonElement>('[data-share]')) {
    if (typeof navigator.share !== 'function') continue
    button.hidden = false
    button.addEventListener('click', () => {
      let field = document.querySelector<HTMLTextAreaElement>(button.dataset.share!)
      if (!field) return
      navigator.share({ title: button.dataset.shareTitle, text: field.value }).catch(() => {})
    })
  }
}
