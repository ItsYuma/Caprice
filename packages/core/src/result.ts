export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: Error): Result<T> {
  return { ok: false, error };
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
      return err(caught);
    }

    if (isString(caught)) {
      return err(new Error(caught));
    }

    return err(new Error(fallback));
  }
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}
