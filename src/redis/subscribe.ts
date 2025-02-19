import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { REDIS_SUB, SERVICES } from '../common/constants';
import { IConfig, FeedbackResponse, GeocodingResponse } from '../common/interfaces';
import { NotFoundError } from '../common/errors';
import { RedisClient } from '../redis/index';

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
