import { container } from 'tsyringe';
import { Application } from 'express';
import { registerExternalValues, RegisterOptions } from './containerConfig';
import { ServerBuilder } from './serverBuilder';

async function getApp(registerOptions?: RegisterOptions): Promise<Application> {
  await registerExternalValues(registerOptions);
  const app = container.resolve(ServerBuilder).build();
  return app;
}

export { getApp };
