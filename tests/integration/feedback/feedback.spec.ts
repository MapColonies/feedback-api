/* eslint-disable @typescript-eslint/naming-convention */
import jsLogger from '@map-colonies/js-logger';
import Redis from 'ioredis';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { IFeedbackModel } from '../../../src/feedback/models/feedback';
import { GeocodingResponse } from '../../../src/common/interfaces';
import { FeedbackRequestSender } from './helpers/requestSender';

describe('feedback', function () {
  let requestSender: FeedbackRequestSender;
  let redisConnection: Redis;

  beforeAll(async function () {
    const { app, container } = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });
    requestSender = new FeedbackRequestSender(app);
    redisConnection = container.resolve<Redis>(SERVICES.REDIS);
  });

  afterAll(async function () {
    if (!['end'].includes(redisConnection.status)) {
      await redisConnection.quit();
    }
  });

  describe('Happy Path', function () {
    it('should return 200 status code and create the feedback', async function () {
      const geocodingResponse: GeocodingResponse = {
        userId: '1',
        apiKey: '1',
        site: 'test',
        response: JSON.parse('["USA"]') as JSON,
        respondedAt: new Date('2024-08-29T14:39:10.602Z'),
      };
      const redisKey = '417a4635-0c59-4b5c-877c-45b4bbaaac7a';
      await redisConnection.set(redisKey, JSON.stringify(geocodingResponse));

      const feedbackModel: IFeedbackModel = {
        request_id: redisKey,
        chosen_result_id: 3,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NO_CONTENT);
    });
  });

  describe('Bad Path', function () {
    it('should return 400 status code since the chosen_result_id is a string', async function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feedbackModel: any = {
        request_id: '4ca82def-e73f-4b57-989b-3e285034b971',
        chosen_result_id: '1',
        user_id: 'user1@mycompany.net',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 status code because user_id is not valid', async function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feedbackModel: any = {
        request_id: '4ca82def-e73f-4b57-989b-3e285034b971',
        chosen_result_id: 1,
        user_id: 'user1',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('Sad Path', function () {
    it('should return 404 status code since the feedback does not exist', async function () {
      const feedbackModel: IFeedbackModel = {
        request_id: '4ca82def-e73f-4b57-989b-3e285034b971',
        chosen_result_id: 1,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });
  });
});
