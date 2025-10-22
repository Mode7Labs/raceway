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
  debug: true,
});

const app = express();
app.use(express.json());
app.use(raceway.middleware());

app.get('/health', (req, res) => {
  res.json({ service: SERVICE_NAME, status: 'healthy' });
});

app.post('/process', async (req, res) => {
  const { downstream, payload } = req.body;

  console.log(`\n[${SERVICE_NAME}] Received request`);
  console.log(`  traceparent: ${req.headers['traceparent']}`);
  console.log(`  raceway-clock: ${req.headers['raceway-clock']}`);
  console.log(`  downstream: ${downstream || 'none'}`);

  // Track some work
  raceway.trackFunctionCall('processRequest', { payload });
  raceway.trackStateChange('requestCount', null, 1, 'Write');

  let downstreamResponse = null;

  // Call downstream service if specified
  if (downstream) {
    console.log(`  Calling downstream: ${downstream}`);

    try {
      const headers = raceway.propagationHeaders();
      console.log(`  Propagating headers:`);
      console.log(`    traceparent: ${headers['traceparent']}`);
      console.log(`    raceway-clock: ${headers['raceway-clock']}`);

      // Get nested downstream if provided (for chaining)
      const nextDownstream = req.body.next_downstream;

      const response = await axios.post(downstream,
        {
          payload: `${SERVICE_NAME} → ${payload}`,
          downstream: nextDownstream
        },
        { headers }
      );
      downstreamResponse = response.data;
    } catch (error: any) {
      console.error(`  Error calling downstream: ${error.message}`);
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
