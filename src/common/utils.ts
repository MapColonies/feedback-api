import { TimeoutError } from './errors';

export const promiseTimeout = async <T>(ms: number, promise: Promise<T>): Promise<T> => {
  // create a promise that rejects in <ms> milliseconds
  const timeout = new Promise<T>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new TimeoutError(`Timed out in + ${ms} + ms.`));
    }, ms);
  });

  // returns a race between our timeout and the passed in promise
  return Promise.race([promise, timeout]);
};
