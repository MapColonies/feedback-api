import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 8080;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METER: Symbol('Meter'),
  REDIS: Symbol('Redis'),
  KAFKA: Symbol('Kafka'),
};
/* eslint-enable @typescript-eslint/naming-convention */

export const ON_SIGNAL = Symbol('onSignal');
export const HEALTHCHECK = Symbol('healthcheck');
export const CLEANUP_REGISTRY = Symbol('cleanupRegistry');
