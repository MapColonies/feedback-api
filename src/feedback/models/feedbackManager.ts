import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { Producer } from 'kafkajs';
import { SERVICES } from '../../common/constants';
import { FeedbackResponse, GeocodingResponse, IConfig } from '../../common/interfaces';
import { RedisClient } from '../../redis';
import { NotFoundError, BadRequestError } from '../../common/errors';
import { IFeedbackModel } from './feedback';

@injectable()
export class FeedbackManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.REDIS) private readonly redisClient: RedisClient,
    @inject(SERVICES.KAFKA) private readonly kafkaProducer: Producer,
    @inject(SERVICES.CONFIG) private readonly config: IConfig
  ) {}

  public async createFeedback(feedback: IFeedbackModel, apiKey: string): Promise<FeedbackResponse> {
    const requestId = feedback.request_id;
    const userId = feedback.user_id;
    const userValidation = this.config.get<string[]>('application.userValidation');
    const ttl = this.config.get<number>('redis.ttl');
    const prefix = this.config.has('redis.prefix') ? this.config.get<string>('redis.prefix') : undefined;

    const validateUser = !userValidation.some((validEnding) => validEnding && userId.endsWith(validEnding));
    if (validateUser) {
      throw new BadRequestError(`user_id not valid. valid user_id ends with "${JSON.stringify(userValidation)}"`);
    }

    const fullRequestId = prefix !== undefined ? `${prefix}:${requestId}` : requestId;

    const feedbackResponse: FeedbackResponse = {
      requestId: requestId,
      chosenResultId: feedback.chosen_result_id,
      userId: userId,
      responseTime: new Date(),
      geocodingResponse: await this.getGeocodingResponse(fullRequestId, userId, apiKey),
    };

    await this.redisClient.setEx(fullRequestId, ttl, JSON.stringify(feedbackResponse.geocodingResponse));

    this.logger.info({ msg: 'creating feedback', requestId });
    await this.send(feedbackResponse);
    return feedbackResponse;
  }

  public async getGeocodingResponse(requestId: string, userId: string, apiKey: string): Promise<GeocodingResponse> {
    try {
      const redisResponse = (await this.redisClient.get(requestId)) as string;
      if (redisResponse) {
        const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
        geocodingResponse.userId = userId;
        geocodingResponse.apiKey = apiKey;
        geocodingResponse.wasUsed = true;
        return geocodingResponse;
      }
    } catch (error) {
      this.logger.error({ msg: `Redis Error: ${(error as Error).message}` });
      throw error;
    }
    throw new NotFoundError('The current request was not found');
  }

  public async send(message: FeedbackResponse): Promise<void> {
    const topic = this.config.get<string>('outputTopic');
    this.logger.info(`Kafka send message. Topic: ${topic}`);
    try {
      await this.kafkaProducer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
      this.logger.info(`Kafka message sent. Topic: ${topic}`);
    } catch (error) {
      this.logger.error({ msg: `Error uploading response to kafka` });
      throw error;
    }
  }
}
