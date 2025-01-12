import { Logger } from '@map-colonies/js-logger';
import { createClient } from 'redis';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { SERVICES } from '../common/constants';
import { IConfig, FeedbackResponse, GeocodingResponse } from '../common/interfaces';
import { NotFoundError } from '../common/errors';

const sendNoChosenResult = async (requestId: string, logger: Logger, config: IConfig, kafkaProducer: Producer, redis: RedisClient): Promise<void> => {
  const feedbackResponse: FeedbackResponse = {
    requestId,
    chosenResultId: '',
    userId: '',
    responseTime: new Date(),
    geocodingResponse: await getNoChosenGeocodingResponse(requestId, logger, redis),
  };
  await send(feedbackResponse, logger, config, kafkaProducer);
};

const getNoChosenGeocodingResponse = async (requestId: string, logger: Logger, redis: RedisClient): Promise<GeocodingResponse> => {
  try {
    const redisResponse = await redis.get(requestId);
    if (redisResponse != null) {
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

export type RedisClient = ReturnType<typeof createClient>;

export const redisSubscribe = async (deps: DependencyContainer): Promise<RedisClient> => {
  const redis = deps.resolve<RedisClient>(SERVICES.REDIS);
  const config = deps.resolve<IConfig>(SERVICES.CONFIG);
  const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
  const logger = deps.resolve<Logger>(SERVICES.LOGGER);

  const additionalDB = config.get<number>('redis.additionalDB');
  const originalDB = config.get<number>('redis.database');
  const redisTTL = config.get<number>('redis.ttl');

  const subscriber = createClient();
  await subscriber.connect();
  logger.info('Connected to redis subscriber');

  await subscriber.subscribe(`__keyevent@${originalDB}__:set`, async (message) => {
    logger.info(`Redis: Got new request ${message}`);

    await redis.select(additionalDB);
    await redis.setEx(message, redisTTL, '');
    await redis.select(originalDB);
  });

  await subscriber.subscribe(`__keyevent@${additionalDB}__:expired`, async (message: string) => {
    let wasUsed;
    const redisResponse = (await redis.get(message)) as string;
    if (redisResponse) {
      const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
      wasUsed = geocodingResponse.wasUsed;
    }
    if (!(wasUsed ?? false)) {
      await sendNoChosenResult(message, logger, config, kafkaProducer, redis);
    }
    await redis.del(message);
  });
  return subscriber;
};
