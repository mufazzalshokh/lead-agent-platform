export type Success<T> = Readonly<{
  ok: true;
  value: T;
}>;

export type Failure<E> = Readonly<{
  ok: false;
  error: E;
}>;

export type Result<T, E> = Success<T> | Failure<E>;

export const success = <T>(value: T): Success<T> =>
  Object.freeze({
    ok: true,
    value,
  });

export const failure = <E>(error: E): Failure<E> =>
  Object.freeze({
    error,
    ok: false,
  });

export const isSuccess = <T, E>(result: Result<T, E>): result is Success<T> => result.ok;

export const isFailure = <T, E>(result: Result<T, E>): result is Failure<E> => !result.ok;
