import httpStatus from 'http-status-codes';
import { HttpError } from '@map-colonies/error-express-handler';

export class TimeoutError extends Error implements HttpError {
  public readonly status = httpStatus.GATEWAY_TIMEOUT;

  public constructor(message: string) {
    super(message);
  }
}

export class NotFoundError extends Error implements HttpError {
  public readonly status = httpStatus.NOT_FOUND;

  public constructor(message: string) {
    super(message);
  }
}

export class BadRequestError extends Error implements HttpError {
  public readonly status = httpStatus.BAD_REQUEST;

  public constructor(message: string) {
    super(message);
  }
}
