// Utility functions for colorizing event types and syntax highlighting

export function getEventKindColor(kind: string): string {
  const lowerKind = kind.toLowerCase();

  // Memory operations - Read: Muted gray, Write: Red (critical mutation)
  if (lowerKind.includes('read') && lowerKind.includes('atomic')) {
    return 'text-gray-400';
  }
  if (lowerKind.includes('read')) {
    return 'text-gray-500';
  }
  if (lowerKind.includes('write') && lowerKind.includes('atomic')) {
    return 'text-red-500';
  }
  if (lowerKind.includes('write')) {
    return 'text-red-400';
  }

  // Thread operations - Muted gray (system-level operations)
  if (lowerKind.includes('spawn') || lowerKind.includes('fork')) {
    return 'text-gray-400';
  }
  if (lowerKind.includes('join') || lowerKind.includes('wait')) {
    return 'text-gray-500';
  }

  // Lock operations - Red (critical, blocking)
  if (lowerKind.includes('acquire') || (lowerKind.includes('lock') && !lowerKind.includes('unlock'))) {
    return 'text-red-500';
  }
  if (lowerKind.includes('release') || lowerKind.includes('unlock')) {
    return 'text-red-400';
  }

  // State operations - Muted gray
  if (lowerKind.includes('state')) {
    return 'text-gray-400';
  }

  // Network/HTTP operations - Muted gray
  if (lowerKind.includes('http') || lowerKind.includes('request') || lowerKind.includes('response')) {
    return 'text-gray-400';
  }

  // Database operations - Muted gray
  if (lowerKind.includes('database') || lowerKind.includes('query') || lowerKind.includes('db')) {
    return 'text-gray-400';
  }

  // Default - Gray
  return 'text-gray-500';
}

export function getEventKindBadgeColor(kind: string): string {
  const lowerKind = kind.toLowerCase();

  // Memory operations - Read: Muted gray, Write: Red accent
  if (lowerKind.includes('read') && lowerKind.includes('atomic')) {
    return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
  if (lowerKind.includes('read')) {
    return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  }
  if (lowerKind.includes('write') && lowerKind.includes('atomic')) {
    return 'bg-red-500/15 text-red-500 border-red-500/30';
  }
  if (lowerKind.includes('write')) {
    return 'bg-red-500/10 text-red-400 border-red-500/25';
  }

  // Thread operations - Muted gray
  if (lowerKind.includes('spawn') || lowerKind.includes('fork')) {
    return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
  if (lowerKind.includes('join') || lowerKind.includes('wait')) {
    return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  }

  // Lock operations - Red accent (critical operations)
  if (lowerKind.includes('acquire') || (lowerKind.includes('lock') && !lowerKind.includes('unlock'))) {
    return 'bg-red-500/15 text-red-500 border-red-500/30';
  }
  if (lowerKind.includes('release') || lowerKind.includes('unlock')) {
    return 'bg-red-500/10 text-red-400 border-red-500/25';
  }

  // State operations - Muted gray
  if (lowerKind.includes('state')) {
    return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }

  // Network/HTTP operations - Muted gray
  if (lowerKind.includes('http') || lowerKind.includes('request') || lowerKind.includes('response')) {
    return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }

  // Database operations - Muted gray
  if (lowerKind.includes('database') || lowerKind.includes('query') || lowerKind.includes('db')) {
    return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }

  // Default - Gray
  return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
}

export function getThreadIdColor(threadId: string): string {
  // Hash the thread ID to get a consistent grayscale shade
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = threadId.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    'text-gray-400',
    'text-gray-500',
    'text-gray-600',
    'text-slate-400',
    'text-slate-500',
    'text-zinc-400',
  ];

  return colors[Math.abs(hash) % colors.length];
}

export function getServiceColor(serviceName: string): string {
  // Hash the service name to get a consistent grayscale shade
  let hash = 0;
  for (let i = 0; i < serviceName.length; i++) {
    hash = serviceName.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    'text-gray-400',
    'text-gray-500',
    'text-gray-600',
    'text-slate-400',
    'text-slate-500',
    'text-zinc-400',
  ];

  return colors[Math.abs(hash) % colors.length];
}

export function getEventKindBackgroundColor(kind: string): string {
  const lowerKind = kind.toLowerCase();

  // Memory operations - Read: Muted gray, Write: Red
  if (lowerKind.includes('read') && lowerKind.includes('atomic')) {
    return 'rgba(107, 114, 128, 0.6)'; // gray-500
  }
  if (lowerKind.includes('read')) {
    return 'rgba(107, 114, 128, 0.5)'; // gray-500
  }
  if (lowerKind.includes('write') && lowerKind.includes('atomic')) {
    return 'rgba(239, 68, 68, 0.8)'; // red-500
  }
  if (lowerKind.includes('write')) {
    return 'rgba(239, 68, 68, 0.6)'; // red-500
  }

  // Thread operations - Muted gray
  if (lowerKind.includes('spawn') || lowerKind.includes('fork')) {
    return 'rgba(107, 114, 128, 0.6)'; // gray-500
  }
  if (lowerKind.includes('join') || lowerKind.includes('wait')) {
    return 'rgba(107, 114, 128, 0.5)'; // gray-500
  }

  // Lock operations - Red (critical)
  if (lowerKind.includes('acquire') || (lowerKind.includes('lock') && !lowerKind.includes('unlock'))) {
    return 'rgba(239, 68, 68, 0.8)'; // red-500
  }
  if (lowerKind.includes('release') || lowerKind.includes('unlock')) {
    return 'rgba(239, 68, 68, 0.6)'; // red-500
  }

  // State operations - Muted gray
  if (lowerKind.includes('state')) {
    return 'rgba(107, 114, 128, 0.6)'; // gray-500
  }

  // Network/HTTP operations - Muted gray
  if (lowerKind.includes('http') || lowerKind.includes('request') || lowerKind.includes('response')) {
    return 'rgba(107, 114, 128, 0.6)'; // gray-500
  }

  // Database operations - Muted gray
  if (lowerKind.includes('database') || lowerKind.includes('query') || lowerKind.includes('db')) {
    return 'rgba(107, 114, 128, 0.6)'; // gray-500
  }

  // Default - Gray
  return 'rgba(107, 114, 128, 0.5)'; // gray-500
}
