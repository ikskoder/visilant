/**
 * A background handler that failed, said in a way the asker can see.
 *
 * The native message listener has to answer something: leaving the channel open
 * hangs the caller for the life of the worker. It used to answer `undefined`,
 * which is indistinguishable from "there is nothing to say about this page" -
 * so a background that could not read its own settings was read as a verdict of
 * safe, and both the warnings and the paste guard went quiet on a page nobody
 * had checked. This is the shape it answers with instead.
 */
export interface MessageError {
  error: string
}

/**
 * Whether an answer is a failure rather than an answer.
 *
 * An answer that carries a `status` is an answer, error field or not: following
 * a short link reports `{ status: 'error', error: 'refused' }` as its result,
 * and read as a failed handler it lost its reason and showed the generic one.
 */
export function isMessageError(value: unknown): value is MessageError {
  return typeof value === 'object' && value !== null && typeof (value as MessageError).error === 'string' && !('status' in value)
}
