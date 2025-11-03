import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://localhost:8080';
const METADATA_PATH = path.join(__dirname, '.seed-metadata.json');

interface TraceMetadata {
  trace_id: string;
  name: string;
  expected_races: number;
  expected_anomalies: number;
  event_count: number;
}

interface SeedMetadata {
  seeded_at: string;
  traces: TraceMetadata[];
}

interface ValidationResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

function loadMetadata(): SeedMetadata | null {
  try {
    if (!fs.existsSync(METADATA_PATH)) {
      return null;
    }
    const content = fs.readFileSync(METADATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load seed metadata:', error);
    return null;
  }
}

async function fetchTraceData(traceId: string) {
  const response = await fetch(`${API_BASE}/api/traces/${traceId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch trace: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function validateTrace(traceId: string, apiResponse: any, metadata: SeedMetadata): ValidationResult {
  const result: ValidationResult = {
    passed: true,
    failures: [],
    warnings: [],
  };

  // Find expected data for this trace
  const expectedTrace = metadata.traces.find((t) => t.trace_id === traceId);

  if (!expectedTrace) {
    result.passed = false;
    result.failures.push(`Trace ID ${traceId} not found in seed metadata`);
    return result;
  }

  // Validate response structure
  if (!apiResponse.success) {
    result.passed = false;
    result.failures.push('API response indicates failure');
    return result;
  }

  if (!apiResponse.data) {
    result.passed = false;
    result.failures.push('API response missing data field');
    return result;
  }

  const data = apiResponse.data;

  // Validate events count
  if (!data.events || !Array.isArray(data.events)) {
    result.passed = false;
    result.failures.push('API response missing events array');
  } else {
    const expectedEventCount = expectedTrace.event_count;
    const actualEventCount = data.events.length;
    if (actualEventCount !== expectedEventCount) {
      result.passed = false;
      result.failures.push(
        `Event count mismatch: expected ${expectedEventCount}, got ${actualEventCount}`
      );
    }
  }

  // Validate analysis
  if (!data.analysis) {
    result.warnings.push('API response missing analysis field');
  } else {
    // Check race conditions
    const expectedRaces = expectedTrace.expected_races || 0;
    const actualRaces = data.analysis.potential_races || 0;
    if (actualRaces !== expectedRaces) {
      result.passed = false;
      result.failures.push(
        `Race count mismatch: expected ${expectedRaces}, got ${actualRaces}`
      );
    }
  }

  // Validate anomalies field (duration-based anomalies, NOT race warning strings)
  if (!data.anomalies || !Array.isArray(data.anomalies)) {
    result.warnings.push('API response missing anomalies array');
  } else {
    const expectedAnomalies = expectedTrace.expected_anomalies || 0;
    const actualAnomalies = data.anomalies.length;
    if (actualAnomalies !== expectedAnomalies) {
      result.passed = false;
      result.failures.push(
        `Anomaly count mismatch: expected ${expectedAnomalies}, got ${actualAnomalies}`
      );
    }
  }

  // Note: Not validating critical path or dependencies as they're not part of expected data

  return result;
}

function printResults(traceId: string, result: ValidationResult, traceName?: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`Validation Results for Trace: ${traceId}`);
  if (traceName) {
    console.log(`Name: ${traceName}`);
  }
  console.log('='.repeat(60));

  if (result.passed) {
    console.log('✅ PASSED - All validations successful!');
  } else {
    console.log('❌ FAILED - Some validations failed');
  }

  if (result.failures.length > 0) {
    console.log('\n❌ Failures:');
    result.failures.forEach((failure, i) => {
      console.log(`  ${i + 1}. ${failure}`);
    });
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach((warning, i) => {
      console.log(`  ${i + 1}. ${warning}`);
    });
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

async function main() {
  const args = process.argv.slice(2);

  // Load metadata
  const metadata = loadMetadata();
  if (!metadata) {
    console.error('❌ Error: Seed metadata not found!');
    console.error('   Please run the seed script first: npx ts-node scripts/seed-database.ts');
    process.exit(1);
  }

  if (args.length === 0) {
    console.error('Usage: npx ts-node scripts/validate-trace.ts <trace-id>');
    console.log('\nAvailable trace IDs from last seed:');
    console.log(`Seeded at: ${metadata.seeded_at}\n`);
    metadata.traces.forEach((trace) => {
      console.log(`  - ${trace.trace_id}`);
      console.log(`    ${trace.name}`);
      console.log(`    Events: ${trace.event_count}, Expected Races: ${trace.expected_races}, Expected Anomalies: ${trace.expected_anomalies}\n`);
    });
    process.exit(1);
  }

  const traceId = args[0];

  // Find trace info
  const traceInfo = metadata.traces.find((t) => t.trace_id === traceId);
  const traceName = traceInfo?.name || '';

  console.log(`Fetching trace data for: ${traceId}...`);
  if (traceName) {
    console.log(`Trace name: ${traceName}`);
  }

  try {
    const apiResponse = await fetchTraceData(traceId);
    const result = validateTrace(traceId, apiResponse, metadata);
    printResults(traceId, result, traceName);

    // Exit with appropriate code
    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Error during validation:');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
