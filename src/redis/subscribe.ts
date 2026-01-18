import { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { REDIS_SUB, SERVICES } from '../common/constants';
import { IConfig, FeedbackResponse, GeocodingResponse } from '../common/interfaces';
import { NotFoundError } from '../common/errors';
import { RedisClient } from '../redis/index';

const TTL_PREFIX = 'ttl:';

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
  const redisClient = deps.resolve<RedisClient>(SERVICES.REDIS);
  const config = deps.resolve<IConfig>(SERVICES.CONFIG);
  const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
  const logger = deps.resolve<Logger>(SERVICES.LOGGER);
  const subscriber = deps.resolve<RedisClient>(REDIS_SUB);

  logger.debug('Redis subscriber init');
  const redisTTL = config.get<number>('redis.expiredResponseTtl');
  const redisPrefix = config.has('redis.prefix') ? config.get<string>('redis.prefix') : undefined;

  const prefixWithTtl = redisPrefix !== undefined ? `${redisPrefix}:${TTL_PREFIX}` : TTL_PREFIX;
  await subscriber.subscribe(`__keyevent@0__:set`, async (message) => {
    if (!message.startsWith(prefixWithTtl)) {
      logger.info(`Redis: Got new request ${message}`);

      const noPrefixMessage = redisPrefix !== undefined ? message.split(':')[1] : message;
      const ttlMessage = prefixWithTtl + noPrefixMessage;
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await redisClient.set(ttlMessage, '', { EX: redisTTL });
    }
  });

  await subscriber.subscribe(`__keyevent@0__:expired`, async (message: string) => {
    if (message.startsWith(prefixWithTtl)) {
      const geocodingMessage = message.substring(prefixWithTtl.length);

      let wasUsed;
      const redisResponse = (await redisClient.get(geocodingMessage)) as string;
      if (redisResponse) {
        const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
        wasUsed = geocodingResponse.wasUsed;
      }
      if (!(wasUsed ?? false)) {
        await sendNoChosenResult(geocodingMessage, logger, config, kafkaProducer, redisClient);
      }
      await redisClient.del(geocodingMessage);
    }
  });
  return subscriber;
};

export const sendNoChosenResult = async (
  requestId: string,
  logger: Logger,
  config: IConfig,
  kafkaProducer: Producer,
  redisClient: RedisClient
): Promise<void> => {
  const feedbackResponse: FeedbackResponse = {
    requestId,
    chosenResultId: null,
    userId: '',
    responseTime: new Date(),
    geocodingResponse: await getNoChosenGeocodingResponse(requestId, logger, redisClient),
  };
  await send(feedbackResponse, logger, config, kafkaProducer);
};

export const getNoChosenGeocodingResponse = async (requestId: string, logger: Logger, redisClient: RedisClient): Promise<GeocodingResponse> => {
  try {
    const redisResponse = await redisClient.get(requestId);
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
