import { readFileSync } from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { type Logger } from '@map-colonies/js-logger';
import { HealthCheck } from '@godaddy/terminus';
import { createClient, RedisClientOptions } from 'redis';
import { type ConfigType } from '@src/common/config';
import { SERVICES } from '../common/constants';
import { RedisConfig } from '../common/interfaces';
import { promiseTimeout } from '../common/utils';

@injectable()
export class RedisClientFactory {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType
  ) {}

  public createConnectionOptions(redisConfig: RedisConfig): Partial<RedisClientOptions> {
    const { host, port, tls, ...clientOptions } = redisConfig;
    const socket = tls.enabled
      ? {
          host,
          port,
          tls: true as const,
          key: tls.key !== '' ? readFileSync(tls.key) : undefined,
          cert: tls.cert !== '' ? readFileSync(tls.cert) : undefined,
          ca: tls.ca !== '' ? readFileSync(tls.ca) : undefined,
        }
      : { host, port };
    return { ...clientOptions, socket };
  }

  public createRedisClient(): RedisClient {
    const dbConfig = this.config.get('redis');
    const connectionOptions = this.createConnectionOptions(dbConfig);

    const redisClient = createClient(connectionOptions)
      .on('error', (error: Error) => this.logger.error({ msg: 'redis client errored', err: error }))
      .on('reconnecting', (...args) => this.logger.warn({ msg: 'redis client reconnecting', ...args }))
      .on('end', (...args) => this.logger.info({ msg: 'redis client end', ...args }))
      .on('connect', (...args) => this.logger.debug({ msg: 'redis client connected', ...args }))
      .on('ready', (...args) => this.logger.debug({ msg: 'redis client is ready', ...args }));

    return redisClient;
  }
}

export type RedisClient = ReturnType<typeof createClient>;

export const CONNECTION_TIMEOUT = 5000;

export const healthCheckFunctionFactory = (redis: RedisClient): HealthCheck => {
  return async (): Promise<void> => {
    const check = redis.ping().then(() => {
      return;
    });
    return promiseTimeout<void>(CONNECTION_TIMEOUT, check);
  };
};
