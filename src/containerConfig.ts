import type { Producer } from 'kafkajs';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import type { HealthCheck } from '@godaddy/terminus';
import type { DependencyContainer } from 'tsyringe/dist/typings/types';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { Registry } from 'prom-client';
import { getOtelMixin } from '@map-colonies/tracing-utils';
import { CLEANUP_REGISTRY, HEALTHCHECK, ON_SIGNAL, REDIS_CLIENT_FACTORY, REDIS_SUB, SERVICES, SERVICE_NAME } from './common/constants';
import { feedbackRouterFactory, FEEDBACK_ROUTER_SYMBOL } from './feedback/routes/feedbackRouter';
import type { InjectionObject } from './common/dependencyRegistration';
import { registerDependencies } from './common/dependencyRegistration';
import type { RedisClient } from './redis';
import { healthCheckFunctionFactory, RedisClientFactory } from './redis';
import { kafkaClientFactory } from './kafka';
import { redisSubscribe } from './redis/subscribe';
import { getConfig, type ConfigType } from './common/config';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useValue: getConfig() } },
      {
        token: SERVICES.LOGGER,
        provider: {
          useFactory: instancePerContainerCachingFactory(async (container) => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            const loggerConfig = config.get('telemetry.logger');
            return jsLogger({ ...loggerConfig, mixin: getOtelMixin() });
          }),
        },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const logger = await deps.resolve<Promise<Logger>>(SERVICES.LOGGER);
          deps.register(SERVICES.LOGGER, { useValue: logger });
        },
      },
      { token: SERVICES.TRACER, provider: { useFactory: instancePerContainerCachingFactory(() => trace.getTracer(SERVICE_NAME)) } },
      {
        token: SERVICES.METRICS,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            const metricsRegistry = new Registry();
            config.initializeMetrics(metricsRegistry);
            return metricsRegistry;
          }),
        },
      },
      { token: SERVICES.METER, provider: { useFactory: instancePerContainerCachingFactory(() => OtelMetrics.getMeter(SERVICE_NAME)) } },
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
          const logger = await deps.resolve<Promise<Logger>>(SERVICES.LOGGER);
          try {
            await kafkaProducer.connect();
            logger.info('Connected to Kafka');
          } catch (error) {
            logger.error({ msg: 'Failed to connect to Kafka', err: error });
          }
        },
      },
      {
        token: REDIS_CLIENT_FACTORY,
        provider: { useClass: RedisClientFactory },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const redisFactory = deps.resolve<RedisClientFactory>(REDIS_CLIENT_FACTORY);

          for (const redisIndex of [SERVICES.REDIS, REDIS_SUB]) {
            const redis = redisFactory.createRedisClient();
            deps.register(redisIndex, { useValue: redis });
            cleanupRegistry.register({
              func: async (): Promise<void> => {
                await redis.quit();
                return Promise.resolve();
              },
              id: redisIndex,
            });
            await redis.connect();

            let redisName = redisIndex.toString();
            redisName = redisName.substring(redisName.indexOf('(') + 1, redisName.lastIndexOf(')'));
            const logger = await deps.resolve<Promise<Logger>>(SERVICES.LOGGER);
            logger.info(`Connected to ${redisName}`);

            if (redisIndex === REDIS_SUB) {
              await redisSubscribe(deps);
            }
          }
        },
      },
      {
        token: HEALTHCHECK,
        provider: {
          useFactory: (container): HealthCheck => {
            const redis = container.resolve<RedisClient>(SERVICES.REDIS);
            return healthCheckFunctionFactory(redis);
          },
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
    throw error;
  }
};
