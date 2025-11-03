"""
Anomaly detection for causal graphs.
Detects race conditions, unexpected state changes, and suspicious patterns.
"""

import numpy as np
from typing import List, Dict, Tuple, Any
from dataclasses import dataclass
import networkx as nx
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler


@dataclass
class Anomaly:
    event_id: str
    anomaly_type: str
    score: float
    description: str
    affected_events: List[str]
    confidence: float


class AnomalyDetector:
    """
    Detects anomalies in causal event graphs using multiple techniques:
    1. Isolation Forest for outlier detection
    2. Temporal pattern analysis
    3. Concurrency hazard detection
    4. State mutation anomaly detection
    """

    def __init__(self):
        self.isolation_forest = IsolationForest(
            contamination=0.1,
            random_state=42,
            n_estimators=100
        )
        self.scaler = StandardScaler()
        self.trained = False

    def extract_features(self, events: List[Dict[str, Any]]) -> np.ndarray:
        """
        Extract features from events for ML analysis.
        Features include:
        - Time between events
        - Number of concurrent events
        - Depth in call stack
        - Number of state mutations
        - Error occurrence
        """
        features = []

        for i, event in enumerate(events):
            feature_vec = []

            # Temporal features
            if i > 0:
                time_delta = (
                    self._parse_timestamp(event['timestamp']) -
                    self._parse_timestamp(events[i-1]['timestamp'])
                ).total_seconds()
            else:
                time_delta = 0
            feature_vec.append(time_delta)

            # Concurrency level (number of events with similar timestamp)
            concurrent_count = sum(
                1 for e in events
                if abs(
                    (self._parse_timestamp(e['timestamp']) -
                     self._parse_timestamp(event['timestamp'])).total_seconds()
                ) < 0.001  # Within 1ms
            )
            feature_vec.append(concurrent_count)

            # Call depth
            depth = self._calculate_depth(event, events)
            feature_vec.append(depth)

            # Event type encoding
            event_type_encoding = self._encode_event_type(event.get('kind', ''))
            feature_vec.extend(event_type_encoding)

            # Has error
            has_error = 1 if event.get('kind') == 'Error' else 0
            feature_vec.append(has_error)

            features.append(feature_vec)

        return np.array(features)

    def train(self, training_events: List[Dict[str, Any]]):
        """Train the anomaly detector on normal traces"""
        features = self.extract_features(training_events)
        features_scaled = self.scaler.fit_transform(features)
        self.isolation_forest.fit(features_scaled)
        self.trained = True

    def detect_anomalies(self, events: List[Dict[str, Any]]) -> List[Anomaly]:
        """
        Detect anomalies in a trace.
        Returns list of detected anomalies with scores and descriptions.
        """
        anomalies = []

        # ML-based outlier detection
        if self.trained:
            ml_anomalies = self._detect_ml_anomalies(events)
            anomalies.extend(ml_anomalies)

        # Rule-based detection
        race_anomalies = self._detect_race_conditions(events)
        anomalies.extend(race_anomalies)

        state_anomalies = self._detect_state_anomalies(events)
        anomalies.extend(state_anomalies)

        timing_anomalies = self._detect_timing_anomalies(events)
        anomalies.extend(timing_anomalies)

        return sorted(anomalies, key=lambda a: a.score, reverse=True)

    def _detect_ml_anomalies(self, events: List[Dict[str, Any]]) -> List[Anomaly]:
        """Use ML model to detect outlier events"""
        features = self.extract_features(events)
        features_scaled = self.scaler.transform(features)

        predictions = self.isolation_forest.predict(features_scaled)
        scores = self.isolation_forest.score_samples(features_scaled)

        anomalies = []
        for i, (pred, score) in enumerate(zip(predictions, scores)):
            if pred == -1:  # Anomaly
                anomalies.append(Anomaly(
                    event_id=events[i].get('id', f'event_{i}'),
                    anomaly_type='ML_OUTLIER',
                    score=abs(score),
                    description=f"Event exhibits unusual patterns compared to normal behavior",
                    affected_events=[events[i].get('id', f'event_{i}')],
                    confidence=min(abs(score) * 10, 1.0)
                ))

        return anomalies

    def _detect_race_conditions(self, events: List[Dict[str, Any]]) -> List[Anomaly]:
        """
        Detect potential race conditions by finding concurrent state mutations
        to the same variable or resource.
        """
        anomalies = []
        state_changes = [e for e in events if e.get('kind') == 'StateChange']

        # Group by variable name and check for concurrent access
        var_groups: Dict[str, List[Dict]] = {}
        for event in state_changes:
            var_name = event.get('data', {}).get('variable', '')
            if var_name not in var_groups:
                var_groups[var_name] = []
            var_groups[var_name].append(event)

        for var_name, changes in var_groups.items():
            if len(changes) < 2:
                continue

            # Check for concurrent changes (within 10ms)
            for i in range(len(changes)):
                for j in range(i + 1, len(changes)):
                    time_diff = abs(
                        (self._parse_timestamp(changes[i]['timestamp']) -
                         self._parse_timestamp(changes[j]['timestamp'])).total_seconds()
                    )

                    if time_diff < 0.01:  # 10ms
                        anomalies.append(Anomaly(
                            event_id=changes[i].get('id', ''),
                            anomaly_type='RACE_CONDITION',
                            score=0.9,
                            description=f"Concurrent modifications to '{var_name}' detected - potential race condition",
                            affected_events=[
                                changes[i].get('id', ''),
                                changes[j].get('id', '')
                            ],
                            confidence=0.85
                        ))

        return anomalies

    def _detect_state_anomalies(self, events: List[Dict[str, Any]]) -> List[Anomaly]:
        """Detect unusual state transitions"""
        anomalies = []
        state_changes = [e for e in events if e.get('kind') == 'StateChange']

        for event in state_changes:
            data = event.get('data', {})
            old_value = data.get('old_value')
            new_value = data.get('new_value')

            # Detect null/undefined transitions
            if old_value is not None and new_value is None:
                anomalies.append(Anomaly(
                    event_id=event.get('id', ''),
                    anomaly_type='NULL_ASSIGNMENT',
                    score=0.7,
                    description=f"Variable '{data.get('variable')}' set to null/undefined",
                    affected_events=[event.get('id', '')],
                    confidence=0.8
                ))

            # Detect rapid state oscillation
            # (This would need more sophisticated tracking)

        return anomalies

    def _detect_timing_anomalies(self, events: List[Dict[str, Any]]) -> List[Anomaly]:
        """Detect timing anomalies like unusually long operations"""
        anomalies = []

        for event in events:
            if event.get('kind') == 'HttpResponse':
                duration_ms = event.get('data', {}).get('duration_ms', 0)
                if duration_ms > 5000:  # More than 5 seconds
                    anomalies.append(Anomaly(
                        event_id=event.get('id', ''),
                        anomaly_type='SLOW_HTTP',
                        score=min(duration_ms / 10000, 1.0),
                        description=f"HTTP request took {duration_ms}ms (threshold: 5000ms)",
                        affected_events=[event.get('id', '')],
                        confidence=0.9
                    ))

            if event.get('kind') == 'DatabaseQuery':
                duration_ms = event.get('data', {}).get('duration_ms', 0)
                if duration_ms > 1000:  # More than 1 second
                    anomalies.append(Anomaly(
                        event_id=event.get('id', ''),
                        anomaly_type='SLOW_QUERY',
                        score=min(duration_ms / 5000, 1.0),
                        description=f"Database query took {duration_ms}ms (threshold: 1000ms)",
                        affected_events=[event.get('id', '')],
                        confidence=0.9
                    ))

        return anomalies

    def _parse_timestamp(self, timestamp: str):
        """Parse ISO timestamp"""
        from datetime import datetime
        return datetime.fromisoformat(timestamp.replace('Z', '+00:00'))

    def _calculate_depth(self, event: Dict, all_events: List[Dict]) -> int:
        """Calculate call stack depth for an event"""
        depth = 0
        current_id = event.get('parent_id')

        while current_id:
            depth += 1
            parent = next((e for e in all_events if e.get('id') == current_id), None)
            if not parent:
                break
            current_id = parent.get('parent_id')

        return depth

    def _encode_event_type(self, event_type: str) -> List[float]:
        """One-hot encode event types"""
        types = [
            'FunctionCall', 'AsyncSpawn', 'AsyncAwait', 'StateChange',
            'HttpRequest', 'HttpResponse', 'DatabaseQuery', 'DatabaseResult',
            'Error', 'Custom'
        ]
        encoding = [1.0 if event_type == t else 0.0 for t in types]
        return encoding


def analyze_causal_graph(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    High-level analysis of a causal graph.
    Returns insights and recommendations.
    """
    detector = AnomalyDetector()
    anomalies = detector.detect_anomalies(events)

    # Build graph statistics
    graph = nx.DiGraph()
    for event in events:
        graph.add_node(event.get('id'))
        if event.get('parent_id'):
            graph.add_edge(event.get('parent_id'), event.get('id'))

    insights = {
        'total_events': len(events),
        'total_anomalies': len(anomalies),
        'graph_depth': max((detector._calculate_depth(e, events) for e in events), default=0),
        'concurrent_events': sum(
            1 for e in events
            if e.get('kind') in ['AsyncSpawn', 'AsyncAwait']
        ),
        'error_count': sum(1 for e in events if e.get('kind') == 'Error'),
        'anomalies': [
            {
                'type': a.anomaly_type,
                'score': a.score,
                'description': a.description,
                'confidence': a.confidence
            }
            for a in anomalies[:10]  # Top 10
        ],
        'graph_metrics': {
            'nodes': graph.number_of_nodes(),
            'edges': graph.number_of_edges(),
            'is_dag': nx.is_directed_acyclic_graph(graph),
        }
    }

    return insights
