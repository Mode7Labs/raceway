import sys
import os
import signal
import atexit

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../../../sdks/python'))

from flask import Flask, request, jsonify
import requests
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

PORT = 6002
SERVICE_NAME = 'python-service'

client = RacewayClient(Config(
    endpoint='http://localhost:8080',
    service_name=SERVICE_NAME,
    instance_id='py-1'
))

# Register shutdown handlers to flush events
def shutdown_handler(signum=None, frame=None):
    print(f"[{SERVICE_NAME}] Shutting down, flushing events...", flush=True)
    client.shutdown()
    sys.exit(0)

signal.signal(signal.SIGTERM, shutdown_handler)
signal.signal(signal.SIGINT, shutdown_handler)
atexit.register(client.shutdown)

app = Flask(__name__)

@app.before_request
def init_raceway():
    flask_middleware(client).before_request()

@app.after_request
def finish_raceway(response):
    return flask_middleware(client).after_request(response)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'service': SERVICE_NAME, 'status': 'healthy'})

@app.route('/process', methods=['POST'])
def process():
    data = request.get_json() or {}
    downstream = data.get('downstream')
    payload = data.get('payload', '')

    # Track some work
    client.track_function_call('process_request', args={'payload': payload})
    client.track_state_change('request_count', None, 1, 'Write')

    downstream_response = None

    # Call downstream service if specified
    if downstream:
        try:
            headers = client.propagation_headers()
            next_downstream = data.get('next_downstream')
            next_next_downstream = data.get('next_next_downstream')

            response = requests.post(
                downstream,
                json={
                    'payload': f"{SERVICE_NAME} → {payload}",
                    'downstream': next_downstream,
                    'next_downstream': next_next_downstream
                },
                headers=headers
            )
            downstream_response = response.json()
        except Exception as e:
            print(f"Error calling downstream: {e}")

    return jsonify({
        'service': SERVICE_NAME,
        'receivedHeaders': {
            'traceparent': request.headers.get('traceparent'),
            'raceway-clock': request.headers.get('raceway-clock'),
        },
        'payload': payload,
        'downstream': downstream_response,
    })

if __name__ == '__main__':
    print(f"{SERVICE_NAME} listening on port {PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
