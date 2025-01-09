import { Logger } from '@map-colonies/js-logger';
import { createClient } from 'redis';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { SERVICES } from '../common/constants';
import { IConfig, FeedbackResponse, GeocodingResponse } from '../common/interfaces';
import { NotFoundError } from '../common/errors';

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

export const requestDict: { [requestId: string]: string } = {};
export type RedisClient = ReturnType<typeof createClient>;

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
