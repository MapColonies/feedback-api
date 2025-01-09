import { readFileSync } from 'fs';
import { Logger } from '@map-colonies/js-logger';
import { HealthCheck } from '@godaddy/terminus';
import { createClient, RedisClientOptions } from 'redis';
import { DependencyContainer, FactoryFunction } from 'tsyringe';
import { Producer } from 'kafkajs';
import { SERVICES } from '../common/constants';
import { RedisConfig, IConfig, FeedbackResponse, GeocodingResponse } from '../common/interfaces';
import { promiseTimeout } from '../common/utils';
import { NotFoundError } from '../common/errors';

const createConnectionOptions = (redisConfig: RedisConfig): Partial<RedisClientOptions> => {
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
};

const sendNoChosenResult = async (requestId: string, logger: Logger, config: IConfig, kafkaProducer: Producer): Promise<void> => {
  const feedbackResponse: FeedbackResponse = {
    requestId,
    chosenResultId: '',
    userId: '',
    responseTime: new Date(),
    geocodingResponse: getNoChosenGeocodingResponse(requestId, logger),
  };
  await send(feedbackResponse, logger, config, kafkaProducer);
};

const getNoChosenGeocodingResponse = (requestId: string, logger: Logger): GeocodingResponse => {
  try {
    const redisResponse = requestDict[requestId];
    if (redisResponse) {
      const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
      return geocodingResponse;
    }
  } catch (error) {
    logger.error({ msg: `Redis Error: ${(error as Error).message}` });
    throw error;
  }
  throw new NotFoundError('The current request was not found');
};

const send = async (message: FeedbackResponse, logger: Logger, config: IConfig, kafkaProducer: Producer): Promise<void> => {
  const topic = config.get<string>('outputTopic');
  logger.info(`Kafka send message. Topic: ${topic}`);
  try {
    await kafkaProducer.connect();
    await kafkaProducer.send({
      topic,
      messages: [{ value: JSON.stringify(message) }],
    });
    logger.info(`Kafka message sent. Topic: ${topic}`);
  } catch (error) {
    logger.error({ msg: `Error uploading response to kafka` });
    throw error;
  }
};

export const CONNECTION_TIMEOUT = 5000;
export type RedisClient = ReturnType<typeof createClient>;
export const requestDict: { [requestId: string]: string } = {};

export const redisClientFactory: FactoryFunction<RedisClient> = (container: DependencyContainer): RedisClient => {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  const dbConfig = config.get<RedisConfig>('redis');
  const connectionOptions = createConnectionOptions(dbConfig);

  const redisClient = createClient(connectionOptions)
    .on('error', (error: Error) => logger.error({ msg: 'redis client errored', err: error }))
    .on('reconnecting', (...args) => logger.warn({ msg: 'redis client reconnecting', ...args }))
    .on('end', (...args) => logger.info({ msg: 'redis client end', ...args }))
    .on('connect', (...args) => logger.debug({ msg: 'redis client connected', ...args }))
    .on('ready', (...args) => logger.debug({ msg: 'redis client is ready', ...args }));

  return redisClient;
};

export const healthCheckFunctionFactory = (redis: RedisClient): HealthCheck => {
  return async (): Promise<void> => {
    const check = redis.ping().then(() => {
      return;
    });
    return promiseTimeout<void>(CONNECTION_TIMEOUT, check);
  };
};

export const redisSubscribe = async (deps: DependencyContainer): Promise<RedisClient> => {
  const redis = deps.resolve<RedisClient>(SERVICES.REDIS);
  const config = deps.resolve<IConfig>(SERVICES.CONFIG);
  const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
  const logger = deps.resolve<Logger>(SERVICES.LOGGER);

  const subscriber = createClient();
  await subscriber.connect();
  logger.info('Connected to redis subscriber');

  await subscriber.subscribe('__keyevent@0__:set', async (message) => {
    requestDict[message] = (await redis.get(message)) as string;
    logger.info(`Redis: Got new request ${message}`);
  });

  await subscriber.subscribe('__keyevent@0__:expired', async (message: string) => {
    if (message in requestDict) {
      await sendNoChosenResult(message, logger, config, kafkaProducer);
      delete requestDict[message];
    }
  });
  return subscriber;
};
