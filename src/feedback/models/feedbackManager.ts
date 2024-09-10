import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { FeedbackResponse, GeocodingResponse } from '../../common/interfaces';
import { RedisClient } from '../../redis';
import { NotFoundError } from '../../common/errors';
import { IFeedbackModel } from './feedback';

@injectable()
export class FeedbackManager {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SERVICES.REDIS) private readonly redis: RedisClient) {}

  public async createFeedback(feedback: IFeedbackModel): Promise<FeedbackResponse> {
    const requestId = feedback.requestId;

    const feedbackResponse: FeedbackResponse = {
      requestId: requestId,
      chosenResultId: feedback.chosenResultId,
      responseTime: new Date(),
      geocodingResponse: await this.getGeocodingResponse(requestId),
    };
    this.logger.info({ msg: 'creating feedback', requestId });

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
}
