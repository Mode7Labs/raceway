/**
 * Raceway - Trace Health
 *
 * Health monitoring component for trace health.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import { useState } from 'react';
import { Alert, AlertTitle, AlertDescription } from '../../../components/ui/alert';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

interface TraceHealthProps {
  raceCount: number;
  anomalyCount: number;
  criticalPathPercentage: number;
}

export function TraceHealth({ raceCount, anomalyCount, criticalPathPercentage }: TraceHealthProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;
  // Calculate health score (0-100)
  let score = 100;

  // Races are critical - heavily penalize
  score -= raceCount * 20;

  // Anomalies are warnings
  score -= anomalyCount * 5;

  // Critical path over 70% is concerning
  if (criticalPathPercentage > 70) {
    score -= (criticalPathPercentage - 70) * 0.5;
  }

  // Clamp between 0-100
  score = Math.max(0, Math.min(100, score));

  const getHealthStatus = () => {
    if (score >= 90) return { label: 'Excellent', variant: 'success' as const, icon: CheckCircle2 };
    if (score >= 70) return { label: 'Good', variant: 'success' as const, icon: CheckCircle2 };
    if (score >= 50) return { label: 'Warning', variant: 'warning' as const, icon: AlertTriangle };
    return { label: 'Critical', variant: 'destructive' as const, icon: AlertCircle };
  };

  const status = getHealthStatus();
  const Icon = status.icon;

  // Build description parts
  const issues: string[] = [];
  if (raceCount > 0) {
    issues.push(`${raceCount} race${raceCount > 1 ? 's' : ''}`);
  }
  if (anomalyCount > 0) {
    issues.push(`${anomalyCount} anomal${anomalyCount > 1 ? 'ies' : 'y'}`);
  }
  if (criticalPathPercentage > 70) {
    issues.push(`High critical path (${Math.round(criticalPathPercentage)}%)`);
  }

  return (
    <Alert variant={status.variant} className="relative p-3">
      <Icon className="h-4 w-4" />
      <AlertTitle className="text-sm font-bold">
        Trace Health: {Math.round(score)} - {status.label}
      </AlertTitle>
      {issues.length > 0 && (
        <AlertDescription className="text-xs">
          {issues.join(' • ')}
        </AlertDescription>
      )}
      <button
        onClick={() => setIsDismissed(true)}
        className="absolute right-2 top-2 rounded-md p-1 outline-none focus:outline-none"
        aria-label="Dismiss alert"
      >
        <X className="h-4 w-4" />
      </button>
    </Alert>
  );
}
