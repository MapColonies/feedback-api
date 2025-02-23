import { readFileSync } from 'fs';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { HealthCheck } from '@godaddy/terminus';
import { createClient, RedisClientOptions } from 'redis';
import { SERVICES } from '../common/constants';
import { RedisConfig, IConfig } from '../common/interfaces';
import { promiseTimeout } from '../common/utils';

@injectable()
export class RedisClientFactory {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SERVICES.CONFIG) private readonly config: IConfig) {}

  public createConnectionOptions(redisConfig: RedisConfig): Partial<RedisClientOptions> {
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
