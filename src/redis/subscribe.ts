import type { Logger } from '@map-colonies/js-logger';
import type { DependencyContainer } from 'tsyringe';
import type { Producer } from 'kafkajs';
import type { ConfigType } from '@src/common/config';
import { REDIS_SUB, SERVICES } from '../common/constants';
import type { FeedbackResponse, GeocodingResponse } from '../common/interfaces';
import { parseGeocodingResponse } from '../common/utils';
import { GeocodingResponseParseError, NotFoundError } from '../common/errors';
import type { RedisClient } from '../redis/index';

const TTL_PREFIX = 'ttl:';

export const send = async (message: FeedbackResponse, logger: Logger, config: ConfigType, kafkaProducer: Producer): Promise<void> => {
  const topic = config.get('kafka.outputTopic');
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
  const config = deps.resolve<ConfigType>(SERVICES.CONFIG);
  const kafkaProducer = deps.resolve<Producer>(SERVICES.KAFKA);
  const logger = deps.resolve<Logger>(SERVICES.LOGGER);
  const subscriber = deps.resolve<RedisClient>(REDIS_SUB);

  logger.debug('Redis subscriber init');
  try {
    await redisClient.sendCommand(['CONFIG', 'SET', 'notify-keyspace-events', 'KEA']);
  } catch (error) {
    logger.warn({
      msg: 'Could not set notify-keyspace-events via CONFIG SET (likely ACL/managed Redis); assuming it is configured server-side',
      err: error,
    });
  }
  const redisTTL = config.get('redis.ttl');
  const redisPrefix = config.get('redis.prefix');
  const dbIndex = config.get('redis.dbIndex') ?? 0;

  const prefixWithTtl = redisPrefix !== undefined ? `${redisPrefix}:${TTL_PREFIX}` : TTL_PREFIX;
  await subscriber.subscribe(`__keyevent@${dbIndex}__:set`, async (message) => {
    try {
      const isTtlKey = message.startsWith(TTL_PREFIX) || message.includes(`:${TTL_PREFIX}`);
      if (!isTtlKey && redisClient.isOpen) {
        logger.info(`Redis: Got new request ${message}`);

        const noPrefixMessage = redisPrefix !== undefined ? message.substring(`${redisPrefix}:`.length) : message;
        const ttlMessage = prefixWithTtl + noPrefixMessage;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        await redisClient.set(ttlMessage, '', { EX: redisTTL });
      }
    } catch (error) {
      logger.error({ msg: 'Redis: failed handling set keyevent', err: error });
    }
  });

  await subscriber.subscribe(`__keyevent@${dbIndex}__:expired`, async (message: string) => {
    try {
      if (message.startsWith(prefixWithTtl) && redisClient.isOpen) {
        const geocodingMessage = message.substring(prefixWithTtl.length);

        const redisResponse = await redisClient.get(geocodingMessage);
        if (redisResponse !== null) {
          const geocodingResponse = parseGeocodingResponse(redisResponse);

          if (geocodingResponse instanceof GeocodingResponseParseError) {
            logger.error({ msg: `Error parsing geocoding response error: ${geocodingResponse.message} }`, err: geocodingResponse });
            throw geocodingResponse;
          }

          if (!(geocodingResponse.wasUsed ?? false)) {
            await sendNoChosenResult(geocodingMessage, logger, config, kafkaProducer, redisClient);
          }

          await redisClient.del(geocodingMessage);
        }
      }
    } catch (error) {
      logger.error({ msg: 'Redis: failed handling expired keyevent', err: error });
    }
  });
  return subscriber;
};

export const sendNoChosenResult = async (
  requestId: string,
  logger: Logger,
  config: ConfigType,
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
      const geocodingResponse = parseGeocodingResponse(redisResponse);

      if (geocodingResponse instanceof GeocodingResponseParseError) {
        logger.error({
          msg: `Error parsing geocoding response for requestId: ${requestId}, error: ${geocodingResponse.message} }`,
          err: geocodingResponse,
        });
        throw geocodingResponse;
      }

      return geocodingResponse;
    }
  } catch (error) {
    logger.error({ msg: `Redis Error: ${(error as Error).message}` });
    throw error;
  }
  throw new NotFoundError(`The current request was not found ${requestId}`);
};
