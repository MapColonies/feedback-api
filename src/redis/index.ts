import { readFileSync } from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { type Logger } from '@map-colonies/js-logger';
import { HealthCheck } from '@godaddy/terminus';
import { createClient, RedisClientOptions } from 'redis';
import { SERVICES } from '../common/constants';
import { RedisConfig, type IConfig } from '../common/interfaces';
import { promiseTimeout } from '../common/utils';

@injectable()
export class RedisClientFactory {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: IConfig
  ) { }

  public createConnectionOptions(redisConfig: RedisConfig): Partial<RedisClientOptions> {
    const { host, port, tls, ...clientOptions } = redisConfig;
    clientOptions.socket = { host, port };
    if (tls.enabled) {
      clientOptions.socket = {
        ...clientOptions.socket,
        tls: true,
        key: tls.key !== '' ? readFileSync(tls.key as string) : undefined,
        cert: tls.cert !== '' ? readFileSync(tls.cert as string) : undefined,
        ca: tls.ca !== '' ? readFileSync(tls.ca as string) : undefined,
      };
    }
    return clientOptions;
  }

  public createRedisClient(): RedisClient {
    const dbConfig = this.config.get<RedisConfig>('redis');
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
