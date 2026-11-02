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
}

/** Input con etiqueta y mensaje de error accesible. */
export function TextInput(handle: Handle<FieldProps>) {
  return () => {
    let { name, label, type = 'text', value, error, required = true, autoComplete, placeholder } = handle.props
    let id = `f-${name}-${handle.id}`
    let errorId = `${id}-error`
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
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
        />
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
