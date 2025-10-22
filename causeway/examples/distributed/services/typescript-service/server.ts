import express from 'express';
import axios from 'axios';
// @ts-ignore - importing from local SDK
import { Raceway } from '../../../../sdks/typescript/src/raceway';

const PORT = 6001;
const SERVICE_NAME = 'typescript-service';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: SERVICE_NAME,
  instanceId: 'ts-1',
});

const app = express();
app.use(express.json());
app.use(raceway.middleware());

app.get('/health', (req, res) => {
  res.json({ service: SERVICE_NAME, status: 'healthy' });
});

app.post('/process', async (req, res) => {
  const { downstream, payload, next_downstream } = req.body;

  // Track some work
  raceway.trackFunctionCall('processRequest', { payload });
  raceway.trackStateChange('requestCount', null, 1, 'Write');

  let downstreamResponse = null;

  // Call downstream service if specified
  if (downstream) {
    try {
      const headers = raceway.propagationHeaders();
      const response = await axios.post(downstream,
        {
          payload: `${SERVICE_NAME} → ${payload}`,
          downstream: next_downstream,
          next_downstream: req.body.next_next_downstream
        },
        { headers }
      );
      downstreamResponse = response.data;
    } catch (error: any) {
      console.error(`Error calling downstream: ${error.message}`);
    }
  }

  res.json({
    service: SERVICE_NAME,
    receivedHeaders: {
      traceparent: req.headers['traceparent'],
      'raceway-clock': req.headers['raceway-clock'],
    },
    payload,
    downstream: downstreamResponse,
  });
});

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
