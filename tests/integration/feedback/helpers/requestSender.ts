import supertest, { type Response } from 'supertest';
import type { Application } from 'express';
import type { IFeedbackModel } from '@src/feedback/models/feedback';

export class FeedbackRequestSender {
  public constructor(private readonly app: Application) {}

  public async createFeedback(body: IFeedbackModel): Promise<Response> {
    return supertest.agent(this.app).post('/feedback').set('Content-Type', 'application/json').send(body);
  }
}
