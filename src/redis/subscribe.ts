import { readFileSync } from 'fs';
import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { createClient, RedisClientOptions } from 'redis';
import { REDIS_SUB, SERVICES } from '../common/constants';
import { IConfig, FeedbackResponse, GeocodingResponse, RedisConfig } from '../common/interfaces';
import { NotFoundError } from '../common/errors';
import { RedisClient } from '../redis/index';

const createConnectionOptions = (redisConfig: RedisConfig): Partial<RedisClientOptions> => {
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
  return clientOptions;
};

export const createRedisClient = (config: IConfig, logger: Logger): RedisClient => {
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

export const send = async (message: FeedbackResponse, logger: Logger, config: IConfig, kafkaProducer: Producer): Promise<void> => {
  const topic = config.get<string>('outputTopic');
  logger.info(`Kafka send message. Topic: ${topic}`);
  try {
    await kafkaProducer.send({
      topic,
      messages: [{ value: JSON.stringify(message) }],
    });
    logger.info(`Kafka message sent. Topic: ${topic}`);
  } catch (error) {
    logger.error({ msg: `Error uploading response to kafka`, message });
    throw error;
  }
};

export const redisSubscribe = async (deps: DependencyContainer): Promise<RedisClient> => {
  const geocodingRedis = deps.resolve<RedisClient>(SERVICES.GEOCODING_REDIS);
  const ttlRedis = deps.resolve<RedisClient>(SERVICES.TTL_REDIS);
  const config = deps.resolve<IConfig>(SERVICES.CONFIG);
  const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
  const logger = deps.resolve<Logger>(SERVICES.LOGGER);
  const subscriber = deps.resolve<RedisClient>(REDIS_SUB);

  logger.debug('Redis subscriber init');
  const ttlDB = config.get<number>('redis.databases.ttlIndex');
  const geocodingDB = config.get<number>('redis.databases.geocodingIndex');
  const redisTTL = config.get<number>('redis.ttl');

  try {
    await subscriber.subscribe(`__keyevent@${geocodingDB}__:set`, async (message) => {
      logger.info(`Redis: Got new request ${message}`);
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await ttlRedis.set(message, '', { EX: redisTTL });
    });

    await subscriber.subscribe(`__keyevent@${ttlDB}__:expired`, async (message: string) => {
      let wasUsed;
      const redisResponse = (await geocodingRedis.get(message)) as string;
      if (redisResponse) {
        const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
        wasUsed = geocodingResponse.wasUsed;
      }
      if (!(wasUsed ?? false)) {
        await sendNoChosenResult(message, logger, config, kafkaProducer, geocodingRedis);
      }
      await geocodingRedis.del(message);
    });
    return subscriber;
  } catch (error) {
    logger.error({ msg: `Redis Subscriber Error: ${(error as Error).message}` });
    throw error;
  }
};

export const sendNoChosenResult = async (
  requestId: string,
  logger: Logger,
  config: IConfig,
  kafkaProducer: Producer,
  geocodingRedis: RedisClient
): Promise<void> => {
  const feedbackResponse: FeedbackResponse = {
    requestId,
    chosenResultId: null,
    userId: '',
    responseTime: new Date(),
    geocodingResponse: await getNoChosenGeocodingResponse(requestId, logger, geocodingRedis),
  };
  await send(feedbackResponse, logger, config, kafkaProducer);
};

export const getNoChosenGeocodingResponse = async (requestId: string, logger: Logger, geocodingRedis: RedisClient): Promise<GeocodingResponse> => {
  try {
    const redisResponse = await geocodingRedis.get(requestId);
    if (redisResponse != null) {
      const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
      return geocodingResponse;
    }
  } catch (error) {
    logger.error({ msg: `Redis Error: ${(error as Error).message}` });
    throw error;
  }
  throw new NotFoundError(`The current request was not found ${requestId}`);
};
