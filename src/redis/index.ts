import { readFileSync } from 'fs';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { createClient, RedisClientOptions } from 'redis';
import { SERVICES } from '../common/constants';
import { RedisConfig, IConfig } from '../common/interfaces';

@injectable()
export class RedisClientFactory {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SERVICES.CONFIG) private readonly config: IConfig) {}

  public createConnectionOptions(redisConfig: RedisConfig, isGeocodingRedis: boolean): Partial<RedisClientOptions> {
    const { host, port, enableSslAuth, sslPaths, databases, ...clientOptions } = redisConfig;
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
    if (isGeocodingRedis) {
      clientOptions.database = databases.geocodingIndex;
    } else {
      clientOptions.database = databases.ttlIndex;
    }
    return clientOptions;
  }

  public createRedisClient(redisIndex: symbol): RedisClient {
    const dbConfig = this.config.get<RedisConfig>('redis');

    const isGeocodingRedis: boolean = redisIndex === SERVICES.GEOCODING_REDIS;
    const connectionOptions = this.createConnectionOptions(dbConfig, isGeocodingRedis);

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
