import config from 'config';
import { Producer } from 'kafkajs';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import { HealthCheck } from '@godaddy/terminus';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { Metrics } from '@map-colonies/telemetry';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { CLEANUP_REGISTRY, HEALTHCHECK, ON_SIGNAL, REDIS_CLIENT_FACTORY, REDIS_SUB, SERVICES, SERVICE_NAME } from './common/constants';
import { tracing } from './common/tracing';
import { feedbackRouterFactory, FEEDBACK_ROUTER_SYMBOL } from './feedback/routes/feedbackRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { RedisClient, RedisClientFactory } from './redis';
import { kafkaClientFactory } from './kafka';
import { createRedisClient, redisSubscribe } from './redis/subscribe';
import { healthCheckFactory } from './common/utils';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
    const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

    const metrics = new Metrics();
    cleanupRegistry.register({ func: metrics.stop.bind(metrics), id: SERVICES.METER });
    metrics.start();

    cleanupRegistry.register({ func: tracing.stop.bind(tracing), id: SERVICES.TRACER });
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
        afterAllInjectionHook(): void {
          const cleanupRegistryLogger = logger.child({ subComponent: 'cleanupRegistry' });

          cleanupRegistry.on('itemFailed', (id, error, msg) => cleanupRegistryLogger.error({ msg, itemId: id, err: error }));
          cleanupRegistry.on('itemCompleted', (id) => cleanupRegistryLogger.info({ itemId: id, msg: `cleanup finished for item ${id.toString()}` }));
          cleanupRegistry.on('finished', (status) => cleanupRegistryLogger.info({ msg: `cleanup registry finished cleanup`, status }));
        },
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
        token: REDIS_CLIENT_FACTORY,
        provider: { useClass: RedisClientFactory },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const redisFactory = deps.resolve<RedisClientFactory>(REDIS_CLIENT_FACTORY);
          for (const redisIndex of [SERVICES.GEOCODING_REDIS, SERVICES.TTL_REDIS]) {
            const redis = redisFactory.createRedisClient(redisIndex);
            deps.register(redisIndex, { useValue: redis });
            cleanupRegistry.register({
              func: async (): Promise<void> => {
                await redis.quit();
                return Promise.resolve();
              },
              id: redisIndex,
            });
            await redis.connect();
            logger.info(`Connected to ${redisIndex.toString()}`);
          }
        },
      },
      {
        token: HEALTHCHECK,
        provider: {
          useFactory: (depContainer): HealthCheck => {
            return healthCheckFactory(depContainer);
          },
        },
      },
      {
        token: REDIS_SUB,
        provider: {
          useFactory: instancePerContainerCachingFactory((): RedisClient => {
            const subscriber = createRedisClient(config, logger);
            return subscriber;
          }),
        },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const subscriber = deps.resolve<RedisClient>(REDIS_SUB);
          cleanupRegistry.register({
            func: async (): Promise<void> => {
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
    throw error;
  }
};
