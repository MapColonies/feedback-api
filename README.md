# Feedback-Api
This is an API that connects to MapColonies geocoding service, and get's feedback from the users.
Geocoding's feedback API collects usage data from the [Geocoding API](https://github.com/MapColonies/Geocoding) user's response and stores it for BI purposes. We use this data to better understand and measure the relevance of our responses and adjust the data and algorithm accordingly.

## API
Checkout the OpenAPI spec [here](/openapi3.yaml)

## Workflow
![workflow img](https://github.com/user-attachments/assets/7ed767ad-02dd-46f3-9de7-d2be72205e2c)

## How does it work?
Once a Geocoding user searches for something using Geocoding's api, it enters Redis (in the geocoding DB index), and an event is triggered. This event adds the `requestId` (from geocoding) to a different Redis DB with a ttl of 5 minutes (TTL DB index).<br/><br/>
When the Geocoding user chooses a result, the requesting system will then send the `request_id`, the `chosen_response_id`, and the `user_id` back to us using the [Feedback api](/openapi3.yaml).<br/>
Once we get the chosen response from the api, we validate it and make sure it exists in the Redis geocoding DB, and once it is validated we add a `wasUsed = true` parameter to the geocoding response (in Redis) for later use. We then send the response to Kafka (where it will later be enriched and added to elastic -> see [Geocoding Enrichment](https://github.com/MapColonies/geocoding-enrichment) for more details).<br/>
Once the TTL of the `requestId` expires an even is triggered, and there are two options:<br/>
1. One or more responses were chosen.
2. No response was chosen (only searched for).

We now go back to the `wasUsed` parameter from earlier, and check to see its value (or even if it exists).<br/>
- If `wasUsed = true` we know from earlier that this response was already chosen and sent to Kafka previously, therefore we can remove it from the Redis geocoding DB index.
- If `wasUsed` equals to one of the following: `false`, `null` or `undefined` then we create a new feedback response and make the `chosenResultId` `null`, and then send this response to Kafka, and delete the request from the Redis geocoding DB index.

## Installation
Install deps with npm

```bash
npm install
```
### Install Git Hooks
```bash
npx husky install
```

## Run Locally

Clone the project

```bash

git clone https://github.com/MapColonies/feedback-api.git

```

Go to the project directory

```bash

cd feedback-api

```

Install dependencies

```bash

npm install

```

Start the server

```bash

npm run start

```

## Running Tests

To run tests, run the following command

```bash

npm run test

```

To only run unit tests:
```bash
npm run test:unit
```

To only run integration tests:
```bash
npm run test:integration
```
