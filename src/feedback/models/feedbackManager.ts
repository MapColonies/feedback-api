import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { Producer } from 'kafkajs';
import { SERVICES } from '../../common/constants';
import { FeedbackResponse, GeocodingResponse, IConfig } from '../../common/interfaces';
import { RedisClient } from '../../redis';
import { NotFoundError } from '../../common/errors';
import { IFeedbackModel } from './feedback';

@injectable()
export class FeedbackManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.REDIS) private readonly redis: RedisClient,
    @inject(SERVICES.KAFKA) private readonly kafkaProducer: Producer,
    @inject(SERVICES.CONFIG) private readonly config: IConfig
  ) {}

  public async createFeedback(feedback: IFeedbackModel): Promise<FeedbackResponse> {
    const requestId = feedback.request_id;
    const feedbackResponse: FeedbackResponse = {
      requestId: requestId,
      chosenResultId: feedback.chosen_result_id,
      responseTime: new Date(),
      geocodingResponse: await this.getGeocodingResponse(requestId),
    };
    this.logger.info({ msg: 'creating feedback', requestId });
    // console.log(feedbackResponse)
    await this.send(feedbackResponse);
    return feedbackResponse;
  }

  public async getGeocodingResponse(requestId: string): Promise<GeocodingResponse> {
    const redisClient = this.redis;

    const redisResponse = (await redisClient.get(requestId)) as string;
    if (redisResponse) {
      const geocodingResponse = JSON.parse(redisResponse) as GeocodingResponse;
      return geocodingResponse;
    }
    throw new NotFoundError('the current request was not found');
  }

  public async send(message: FeedbackResponse): Promise<void> {
    const topic = this.config.get<string>('outputTopic');
    this.logger.info(`Kafka Send message. Topic: ${topic}`);
    try {
      await this.kafkaProducer.send({
        topic,
        messages: [
          {
            value: JSON.stringify(message),
          },
        ],
      });
      this.logger.info(`Kafka message sent. Topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Error uploading response to kafka`);
      throw error;
    }
  }
}
