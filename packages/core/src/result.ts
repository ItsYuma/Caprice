export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(message: string): Result<T> {
  return { ok: false, error: new Error(message) };
}

export function fromCause<T>(cause: unknown, fallback: string): Result<T> {
  if (cause instanceof Error && cause.message.length > 0) {
    return { ok: false, error: cause };
  }

  if (isString(cause) && cause.length > 0) {
    return fail(cause);
  }

  return fail(fallback);
}

export async function tryCatch<T>(
  promise: Promise<T>,
  fallback: string,
): Promise<Result<T>> {
  try {
    const value = await promise;

    return ok(value);
  } catch (caught) {
    if (isError(caught)) {
      return { ok: false, error: caught };
    }

    if (isString(caught)) {
      return fail(caught);
    }

    return fail(fallback);
  }
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}
