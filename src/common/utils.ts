import { DependencyContainer } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { HealthCheck } from '@godaddy/terminus';
import { RedisClient } from '../redis/index';
import { SERVICES } from './constants';

export const healthCheckFactory = (container: DependencyContainer): HealthCheck => {
  return async (): Promise<void> => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const geocodingRedis = container.resolve<RedisClient>(SERVICES.GEOCODING_REDIS);
    const ttlRedis = container.resolve<RedisClient>(SERVICES.TTL_REDIS);

    const promises: Promise<unknown>[] = [];

    promises.push(
      new Promise((resolve, reject) => {
        geocodingRedis
          .ping()
          .then(() => {
            resolve('Healthcheck passed for GeocodingRedis connection');
          })
          .catch((error: Error) => {
            reject({
              msg: `Healthcheck failed for GeocodingRedis.`,
              error,
            });
          });
      })
    );
    promises.push(
      new Promise((resolve, reject) => {
        ttlRedis
          .ping()
          .then(() => {
            resolve('Healthcheck passed for TTLRedis connection');
          })
          .catch((error: Error) => {
            reject({
              msg: `Healthcheck failed for TTLRedis.`,
              error,
            });
          });
      })
    );

    await Promise.allSettled(promises).then((results) => {
      results.forEach((msg) => logger.debug({ msg }));
    });

    return Promise.resolve();
  };
};
