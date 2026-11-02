import type { Handle } from 'remix/component'

export interface FieldProps {
  name: string
  label: string
  type?: 'text' | 'email' | 'password' | 'url' | 'number' | 'search' | 'tel'
  value?: string
  error?: string
  required?: boolean
  autoComplete?: string
  placeholder?: string
  inputMode?: 'text' | 'decimal' | 'numeric' | 'search'
  /** Ayuda corta bajo el campo. */
  hint?: string
}

/** Input con etiqueta y mensaje de error accesible. */
export function TextInput(handle: Handle<FieldProps>) {
  return () => {
    let { name, label, type = 'text', value, error, required = true, autoComplete, placeholder, inputMode, hint } =
      handle.props
    let id = `f-${name}-${handle.id}`
    let errorId = `${id}-error`
    let hintId = `${id}-hint`
    let describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name={name}
          type={type as 'text'}
          defaultValue={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
        />
        {hint ? (
          <p id={hintId} class="field-hint">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} class="field-error">
            {error}
          </p>
        ) : null}
      </div>
    )
  }
}

export function PasswordInput(handle: Handle<Omit<FieldProps, 'type' | 'value'>>) {
  return () => <TextInput {...handle.props} type="password" />
}

export interface TextAreaProps {
  name: string
  label: string
  value?: string
  error?: string
  hint?: string
  rows?: number
  placeholder?: string
}

export function TextArea(handle: Handle<TextAreaProps>) {
  return () => {
    let { name, label, value, error, hint, rows = 3, placeholder } = handle.props
    let id = `f-${name}-${handle.id}`
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          name={name}
          rows={rows}
          placeholder={placeholder}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          defaultValue={value ?? ''}
        />
        {hint ? (
          <p id={`${id}-hint`} class="field-hint">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} class="field-error">
            {error}
          </p>
        ) : null}
      </div>
    )
  }
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectGroup {
  label: string
  options: SelectOption[]
}

export interface SelectProps {
  name: string
  label: string
  value?: string
  error?: string
  /** Texto de la opción vacía (valor ""). Si se omite, no hay opción vacía. */
  empty?: string
  options?: SelectOption[]
  groups?: SelectGroup[]
}

export function Select(handle: Handle<SelectProps>) {
  return () => {
    let { name, label, value = '', error, empty, options = [], groups = [] } = handle.props
    let id = `f-${name}-${handle.id}`
    let renderOption = (o: SelectOption) => (
      <option key={o.value} value={o.value} selected={o.value === value}>
        {o.label}
      </option>
    )
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        <select id={id} name={name} aria-invalid={error ? 'true' : undefined}>
          {empty !== undefined ? (
            <option value="" selected={value === ''}>
              {empty}
            </option>
          ) : null}
          {options.map(renderOption)}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map(renderOption)}
            </optgroup>
          ))}
        </select>
        {error ? <p class="field-error">{error}</p> : null}
      </div>
    )
  }
}
