import * as supertest from 'supertest';
import { IFeedbackModel } from '../../../../src/feedback/models/feedback';

export class FeedbackRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async createFeedback(body: IFeedbackModel): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/feedback').set('Content-Type', 'application/json').send(body);
  }
}
