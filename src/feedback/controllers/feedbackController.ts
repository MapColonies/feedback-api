import { Logger } from '@map-colonies/js-logger';
import { BoundCounter, Meter } from '@opentelemetry/api-metrics';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { IFeedbackModel } from '../models/feedback';
import { FeedbackManager } from '../models/feedbackManager';
import { FeedbackResponse } from '../../common/interfaces';

type CreateFeedbackHandler = RequestHandler<undefined, FeedbackResponse, IFeedbackModel>;

@injectable()
export class FeedbackController {
  private readonly createdFeedbackCounter: BoundCounter;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(FeedbackManager) private readonly manager: FeedbackManager,
    @inject(SERVICES.METER) private readonly meter: Meter
  ) {
    this.createdFeedbackCounter = meter.createCounter('created_feedback');
  }

  public createFeedback: CreateFeedbackHandler = async (req, res) => {
    const createdFeedback = this.manager.createFeedback(req.body);
    this.createdFeedbackCounter.add(1);
    return res.status(httpStatus.NO_CONTENT).json(await createdFeedback);
  };
}
