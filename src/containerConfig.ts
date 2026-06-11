import { Producer } from 'kafkajs';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import { HealthCheck } from '@godaddy/terminus';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import { jsLogger } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { CLEANUP_REGISTRY, HEALTHCHECK, ON_SIGNAL, REDIS_CLIENT_FACTORY, REDIS_SUB, SERVICES, SERVICE_NAME } from './common/constants';
import { feedbackRouterFactory, FEEDBACK_ROUTER_SYMBOL } from './feedback/routes/feedbackRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { healthCheckFunctionFactory, RedisClient, RedisClientFactory } from './redis';
import { kafkaClientFactory } from './kafka';
import { redisSubscribe } from './redis/subscribe';
import { getConfig } from './common/config';
import { Registry } from 'prom-client';
import { getOtelMixin } from '@map-colonies/tracing-utils';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const configInstance = getConfig();

    const loggerConfig = configInstance.get('telemetry.logger');
    const logger = await jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });
    const metricsRegistry = new Registry();
    configInstance.initializeMetrics(metricsRegistry);

    const tracer = trace.getTracer(SERVICE_NAME);

    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      { token: SERVICES.METRICS, provider: { useValue: metricsRegistry } },
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
