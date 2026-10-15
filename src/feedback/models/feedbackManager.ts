import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { type Producer } from 'kafkajs';
import { SERVICES } from '@common/constants';
import { FeedbackResponse, GeocodingResponse } from '@common/interfaces';
import { parseGeocodingResponse } from '@common/utils';
import { NotFoundError, BadRequestError, GeocodingResponseParseError } from '@common/errors';
import { withSpan } from '@common/tracing';
import { type ConfigType } from '@src/common/config';
import { type RedisClient } from '../../redis';
import { KafkaAttributes, KafkaSpanName } from '../../kafka/tracing';
import { FeedbackAttributes, FeedbackSpanName } from '../tracing';
import { IFeedbackModel } from './feedback';

@injectable()
export class FeedbackManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.REDIS) private readonly redisClient: RedisClient,
    @inject(SERVICES.KAFKA) private readonly kafkaProducer: Producer,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType
  ) {}

  public async createFeedback(feedback: IFeedbackModel, apiKey: string): Promise<FeedbackResponse> {
    const requestId = feedback.request_id;

    return withSpan(
      FeedbackSpanName.MANAGER_CREATE_FEEDBACK,
      { attributes: { [FeedbackAttributes.REQUEST_ID]: requestId, [FeedbackAttributes.CHOSEN_RESULT_ID]: feedback.chosen_result_id } },
      async () => {
        const userId = feedback.user_id;
        const userValidation = this.config.get('application.userValidation');
        const ttl = this.config.get('redis.ttl');
        const prefix = this.config.get('redis.prefix');

        const validateUser = !userValidation.some((validEnding: string) => validEnding !== '' && userId.endsWith(validEnding));
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
    );
  }

  public async getGeocodingResponse(requestId: string, userId: string, apiKey: string): Promise<GeocodingResponse> {
    return withSpan(FeedbackSpanName.MANAGER_GET_GEOCODING_RESPONSE, { attributes: { [FeedbackAttributes.REQUEST_ID]: requestId } }, async (span) => {
      try {
        const redisResponse = await this.redisClient.get(requestId);
        if (redisResponse != null) {
          const geocodingResponse = parseGeocodingResponse(redisResponse);

          if (geocodingResponse instanceof GeocodingResponseParseError) {
            this.logger.error({
              msg: `Error parsing geocoding response for requestId: ${requestId}, error: ${geocodingResponse.message} }`,
              err: geocodingResponse,
            });
            throw geocodingResponse;
          }

          span?.setAttribute(FeedbackAttributes.GEOCODING_SITE, geocodingResponse.site);

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
    });
  }

  public async send(message: FeedbackResponse): Promise<void> {
    const topic = this.config.get('kafka.outputTopic');

    return withSpan(
      KafkaSpanName.SEND,
      { attributes: { [KafkaAttributes.TOPIC]: topic, [FeedbackAttributes.REQUEST_ID]: message.requestId } },
      async () => {
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
    );
  }
}
