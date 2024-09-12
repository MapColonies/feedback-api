import { readFileSync } from 'fs';
import { Logger } from '@map-colonies/js-logger';
import { HealthCheck } from '@godaddy/terminus';
import { createClient, RedisClientOptions } from 'redis';
import { DependencyContainer, FactoryFunction } from 'tsyringe';
import { SERVICES } from '../common/constants';
import { RedisConfig, IConfig } from '../common/interfaces';
import { promiseTimeout } from '../common/utils';

const DEFAULT_LIMIT_FROM = 0;
const DEFAULT_LIMIT_SIZE = 1000;

const createConnectionOptions = (redisConfig: RedisConfig): Partial<RedisClientOptions> => {
  const { host, port, enableSslAuth, sslPaths, ...clientOptions } = redisConfig;
  clientOptions.socket = { host, port };
  if (enableSslAuth) {
    clientOptions.socket = {
      ...clientOptions.socket,
      tls: true,
      key: sslPaths.key !== '' ? readFileSync(sslPaths.key) : undefined,
      cert: sslPaths.cert !== '' ? readFileSync(sslPaths.cert) : undefined,
      ca: sslPaths.ca !== '' ? readFileSync(sslPaths.ca) : undefined,
    };
  }

  return clientOptions;
};

export const CONNECTION_TIMEOUT = 5000;

export const DEFAULT_LIMIT = { from: DEFAULT_LIMIT_FROM, size: DEFAULT_LIMIT_SIZE };

export type RedisClient = ReturnType<typeof createClient>;

export const redisClientFactory: FactoryFunction<RedisClient> = (container: DependencyContainer): RedisClient => {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  const dbConfig = config.get<RedisConfig>('redis');
  const connectionOptions = createConnectionOptions(dbConfig);

  const redisClient = createClient(connectionOptions)
    .on('error', (error: Error) => logger.error({ msg: 'redis client errored', err: error }))
    .on('reconnecting', (...args) => logger.warn({ msg: 'redis client reconnecting', ...args }))
    .on('end', (...args) => logger.info({ msg: 'redis client end', ...args }))
    .on('connect', (...args) => logger.debug({ msg: 'redis client connected', ...args }))
    .on('ready', (...args) => logger.debug({ msg: 'redis client is ready', ...args }));

  return redisClient;
};

export const healthCheckFunctionFactory = (redis: RedisClient): HealthCheck => {
  return async (): Promise<void> => {
    const check = redis.ping().then(() => {
      return;
    });
    return promiseTimeout<void>(CONNECTION_TIMEOUT, check);
  };
};
