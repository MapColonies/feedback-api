import { DependencyContainer, FactoryFunction } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import { RedisClient } from '../redis/index';
import { SERVICES } from './constants';

export const healthCheckFactory: FactoryFunction<void> = (container: DependencyContainer): void => {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const geocodingRedis = container.resolve<RedisClient>(SERVICES.GEOCODING_REDIS);
  const ttlRedis = container.resolve<RedisClient>(SERVICES.TTL_REDIS);

  geocodingRedis
    .ping()
    .then(() => {
      return;
    })
    .catch((error: Error) => {
      logger.error({
        message: `Healthcheck failed for GeocodingRedis.`,
        error,
      });
    });

  ttlRedis
    .ping()
    .then(() => {
      return;
    })
    .catch((error: Error) => {
      logger.error({
        message: `Healthcheck failed for GeocodingRedis.`,
        error,
      });
    });
};
