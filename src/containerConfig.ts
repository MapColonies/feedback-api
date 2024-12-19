import config from 'config';
import { Producer } from 'kafkajs';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { Metrics } from '@map-colonies/telemetry';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { HealthCheck } from '@godaddy/terminus';
import { CLEANUP_REGISTRY, HEALTHCHECK, ON_SIGNAL, SERVICES, SERVICE_NAME } from './common/constants';
import { tracing } from './common/tracing';
import { feedbackRouterFactory, FEEDBACK_ROUTER_SYMBOL } from './feedback/routes/feedbackRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { healthCheckFunctionFactory, RedisClient, redisClientFactory } from './redis';
import { kafkaClientFactory } from './kafka';

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
      },
      {
        token: SERVICES.REDIS,
        provider: { useFactory: instancePerContainerCachingFactory(redisClientFactory) },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const redis = deps.resolve<RedisClient>(SERVICES.REDIS);
          cleanupRegistry.register({ func: redis.disconnect.bind(redis), id: SERVICES.REDIS });
          await redis.connect();
        },
      },
      {
        token: SERVICES.KAFKA,
        provider: { useFactory: kafkaClientFactory },
        postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
          const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
          cleanupRegistry.register({ func: kafkaProducer.disconnect.bind(kafkaProducer), id: SERVICES.KAFKA });
          try {
            await kafkaProducer.connect();
            logger.info('Connected to Kafka');
          } catch (error) {
            logger.error({ msg: 'Failed to connect to Kafka', err: error });
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
          useFactory: instancePerContainerCachingFactory((container) => {
            const cleanupRegistry = container.resolve<CleanupRegistry>(CLEANUP_REGISTRY);
            return cleanupRegistry.trigger.bind(cleanupRegistry);
          }),
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
