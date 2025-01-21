import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 8080;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METER: Symbol('Meter'),
  GEOCODING_REDIS: Symbol('GeocodingRedis'),
  TTL_REDIS: Symbol('TTLRedis'),
  KAFKA: Symbol('Kafka'),
} satisfies Record<string, symbol>;
/* eslint-enable @typescript-eslint/naming-convention */

export const ON_SIGNAL = Symbol('onSignal');
export const HEALTHCHECK = Symbol('healthcheck');
export const CLEANUP_REGISTRY = Symbol('cleanupRegistry');
export const REDIS_SUB = Symbol('redisSubClient');
