export class ValidationError extends Error {
  readonly code = 'validation_error'

  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function requireRecord(value: unknown, label = 'value'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ValidationError(`${label} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0) throw new ValidationError(`${label} must not be empty`)
  if (normalized.length > maxLength) throw new ValidationError(`${label} exceeds ${maxLength} characters`)
  return normalized
}

export function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, label, maxLength)
}

export function boundedNumber(value: unknown, label: string, fallback: number, min = 0, max = 1): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${label} must be a finite number from ${min} to ${max}`)
  }
  return value
}

export function enumValue<T extends readonly string[]>(value: unknown, label: string, allowed: T, fallback?: T[number]): T[number] {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`)
  }
  return value as T[number]
}
