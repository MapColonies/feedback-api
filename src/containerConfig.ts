import config from 'config';
import { Producer } from 'kafkajs';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { Logger, LoggerOptions } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { Metrics } from '@map-colonies/telemetry';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { HealthCheck } from '@godaddy/terminus';
import { createClient } from 'redis';
import { CLEANUP_REGISTRY, GEOCODING_HEALTHCHECK, TTL_HEALTHCHECK, ON_SIGNAL, REDIS_SUB, SERVICES, SERVICE_NAME } from './common/constants';
import { tracing } from './common/tracing';
import { feedbackRouterFactory, FEEDBACK_ROUTER_SYMBOL } from './feedback/routes/feedbackRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { healthCheckFunctionFactory, RedisClient, redisClientFactory } from './redis';
import { kafkaClientFactory } from './kafka';
import { redisSubscribe } from './redis/subscribe';

let logger: Logger; //n/a

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
    // const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });
    logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() }); //n/a

    const metrics = new Metrics();
    cleanupRegistry.register({
      func: async (): Promise<void> => {
        await metrics.stop();
        return Promise.resolve();
      },
      id: SERVICES.METER,
    });
    metrics.start();

    cleanupRegistry.register({
      func: async (): Promise<void> => {
        await tracing.stop();
        return Promise.resolve();
      },
      id: SERVICES.TRACER,
    });
    tracing.start();
    const tracer = trace.getTracer(SERVICE_NAME);

    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useValue: config } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      { token: SERVICES.METER, provider: { useValue: OtelMetrics.getMeterProvider().getMeter(SERVICE_NAME) } },
      { token: FEEDBACK_ROUTER_SYMBOL, provider: { useFactory: feedbackRouterFactory } },
      {
        token: CLEANUP_REGISTRY,
        provider: { useValue: cleanupRegistry },
      },
      {
        token: SERVICES.KAFKA,
        provider: { useFactory: instancePerContainerCachingFactory(kafkaClientFactory) },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
          cleanupRegistry.register({
            func: async (): Promise<void> => {
              await kafkaProducer.disconnect();
              return Promise.resolve();
            },
            id: SERVICES.KAFKA,
          });
          try {
            await kafkaProducer.connect();
            logger.info('Connected to Kafka');
          } catch (error) {
            logger.error({ msg: 'Failed to connect to Kafka', err: error });
          }
        },
      },
      {
        token: 'isGeocodingRedis',
        provider: { useValue: true },
      },
      {
        token: SERVICES.GEOCODING_REDIS,
        provider: { useFactory: instancePerContainerCachingFactory(redisClientFactory) },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const geocodingRedis = deps.resolve<RedisClient>(SERVICES.GEOCODING_REDIS);
          deps.register<boolean>('isGeocodingRedis', { useValue: false });
          cleanupRegistry.register({
            func: async (): Promise<void> => {
              logger.info(`!!!!!!!! geocodingRedis CLEANUP WAS TRIGGERED`) //n/a
              await geocodingRedis.quit();
              return Promise.resolve();
            },
            id: SERVICES.GEOCODING_REDIS,
          });
          await geocodingRedis.connect();
          logger.info('Connected to GeocodingRedis');
        },
      },
      {
        token: SERVICES.TTL_REDIS,
        provider: { useFactory: instancePerContainerCachingFactory(redisClientFactory) },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const ttlRedis = deps.resolve<RedisClient>(SERVICES.TTL_REDIS);
          cleanupRegistry.register({
            func: async (): Promise<void> => {
              logger.info(`!!!!!!!! ttlRedis CLEANUP WAS TRIGGERED`) //n/a
              await ttlRedis.quit();
              return Promise.resolve();
            },
            id: SERVICES.TTL_REDIS,
          });
          await ttlRedis.connect();
          logger.info('Connected to TTLRedis');
        },
      },
      {
        token: GEOCODING_HEALTHCHECK,
        provider: {
          useFactory: (container): HealthCheck => {
            const geocodingRedis = container.resolve<RedisClient>(SERVICES.GEOCODING_REDIS);
            return healthCheckFunctionFactory(geocodingRedis);
          },
        },
      },
      {
        token: TTL_HEALTHCHECK,
        provider: {
          useFactory: (container): HealthCheck => {
            const ttlRedis = container.resolve<RedisClient>(SERVICES.TTL_REDIS);
            return healthCheckFunctionFactory(ttlRedis);
          },
        },
      },
      {
        token: REDIS_SUB,
        provider: {
          useFactory: instancePerContainerCachingFactory((): RedisClient => {
            const subscriber = createClient();
            return subscriber;
          }),
        },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const subscriber = deps.resolve<RedisClient>(REDIS_SUB);
          cleanupRegistry.register({
            func: async () => {
              logger.info(`!!!!!!!! subscriber CLEANUP WAS TRIGGERED`) //n/a
              await subscriber.quit();
              return Promise.resolve();
            },
            id: REDIS_SUB,
          });
          await subscriber.connect();
          logger.info('Connected to Redis Subscriber');
          await redisSubscribe(deps);
        },
      },
      {
        token: ON_SIGNAL,
        provider: {
          useValue: cleanupRegistry.trigger.bind(cleanupRegistry),
        },
      },
    ];

    const container = await registerDependencies(dependencies, options?.override, options?.useChild);
    return container;
  } catch (error) {
    await cleanupRegistry.trigger();
    logger.info(`!!!!!!!!CLEANUP WAS TRIGGERED`) //n/a
    logger.error(error) //n/a
    throw error;
  }
};
