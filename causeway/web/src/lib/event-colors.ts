// Utility functions for colorizing event types and syntax highlighting

export function getEventKindColor(kind: string): string {
  const lowerKind = kind.toLowerCase();

  // Memory operations - Read: Cyan (cool, read-only), Write: Orange (warm, changing)
  if (lowerKind.includes('read') && lowerKind.includes('atomic')) {
    return 'text-cyan-400';
  }
  if (lowerKind.includes('read')) {
    return 'text-cyan-300';
  }
  if (lowerKind.includes('write') && lowerKind.includes('atomic')) {
    return 'text-orange-400';
  }
  if (lowerKind.includes('write')) {
    return 'text-orange-300';
  }

  // Thread operations - Purple (parallel/concurrent operations)
  if (lowerKind.includes('spawn') || lowerKind.includes('fork')) {
    return 'text-purple-400';
  }
  if (lowerKind.includes('join') || lowerKind.includes('wait')) {
    return 'text-purple-300';
  }

  // Lock operations - Pink/Magenta (critical, blocking)
  if (lowerKind.includes('acquire') || (lowerKind.includes('lock') && !lowerKind.includes('unlock'))) {
    return 'text-pink-400';
  }
  if (lowerKind.includes('release') || lowerKind.includes('unlock')) {
    return 'text-pink-300';
  }

  // State operations - Blue (stable, system-level)
  if (lowerKind.includes('state')) {
    return 'text-blue-400';
  }

  // Network/HTTP operations - Cyan (query/request oriented)
  if (lowerKind.includes('http') || lowerKind.includes('request') || lowerKind.includes('response')) {
    return 'text-cyan-400';
  }

  // Database operations - Cyan (query oriented)
  if (lowerKind.includes('database') || lowerKind.includes('query') || lowerKind.includes('db')) {
    return 'text-cyan-400';
  }

  // Default - Gray
  return 'text-gray-400';
}

export function getEventKindBadgeColor(kind: string): string {
  const lowerKind = kind.toLowerCase();

  // Memory operations - Read: Cyan, Write: Orange
  if (lowerKind.includes('read') && lowerKind.includes('atomic')) {
    return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
  }
  if (lowerKind.includes('read')) {
    return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
  }
  if (lowerKind.includes('write') && lowerKind.includes('atomic')) {
    return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
  }
  if (lowerKind.includes('write')) {
    return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
  }

  // Thread operations - Purple
  if (lowerKind.includes('spawn') || lowerKind.includes('fork')) {
    return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
  }
  if (lowerKind.includes('join') || lowerKind.includes('wait')) {
    return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
  }

  // Lock operations - Pink/Magenta
  if (lowerKind.includes('acquire') || (lowerKind.includes('lock') && !lowerKind.includes('unlock'))) {
    return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
  }
  if (lowerKind.includes('release') || lowerKind.includes('unlock')) {
    return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
  }

  // State operations - Blue
  if (lowerKind.includes('state')) {
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  }

  // Network/HTTP operations - Cyan
  if (lowerKind.includes('http') || lowerKind.includes('request') || lowerKind.includes('response')) {
    return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
  }

  // Database operations - Cyan
  if (lowerKind.includes('database') || lowerKind.includes('query') || lowerKind.includes('db')) {
    return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
  }

  // Default - Gray
  return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
}

export function getThreadIdColor(threadId: string): string {
  // Hash the thread ID to get a consistent color
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = threadId.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    'text-cyan-400',
    'text-blue-400',
    'text-purple-400',
    'text-pink-400',
    'text-orange-400',
    'text-gray-400',
  ];

  return colors[Math.abs(hash) % colors.length];
}

export function getServiceColor(serviceName: string): string {
  // Hash the service name to get a consistent color
  let hash = 0;
  for (let i = 0; i < serviceName.length; i++) {
    hash = serviceName.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    'text-cyan-300',
    'text-blue-300',
    'text-purple-300',
    'text-pink-300',
    'text-orange-300',
    'text-gray-300',
  ];

  return colors[Math.abs(hash) % colors.length];
}

export function getEventKindBackgroundColor(kind: string): string {
  const lowerKind = kind.toLowerCase();

  // Memory operations - Read: Cyan, Write: Orange
  if (lowerKind.includes('read') && lowerKind.includes('atomic')) {
    return 'rgba(6, 182, 212, 0.8)'; // cyan-500
  }
  if (lowerKind.includes('read')) {
    return 'rgba(6, 182, 212, 0.8)'; // cyan-500
  }
  if (lowerKind.includes('write') && lowerKind.includes('atomic')) {
    return 'rgba(249, 115, 22, 0.8)'; // orange-500
  }
  if (lowerKind.includes('write')) {
    return 'rgba(249, 115, 22, 0.8)'; // orange-500
  }

  // Thread operations - Purple
  if (lowerKind.includes('spawn') || lowerKind.includes('fork')) {
    return 'rgba(168, 85, 247, 0.8)'; // purple-500
  }
  if (lowerKind.includes('join') || lowerKind.includes('wait')) {
    return 'rgba(168, 85, 247, 0.8)'; // purple-500
  }

  // Lock operations - Pink/Magenta
  if (lowerKind.includes('acquire') || (lowerKind.includes('lock') && !lowerKind.includes('unlock'))) {
    return 'rgba(236, 72, 153, 0.8)'; // pink-500
  }
  if (lowerKind.includes('release') || lowerKind.includes('unlock')) {
    return 'rgba(236, 72, 153, 0.8)'; // pink-500
  }

  // State operations - Blue
  if (lowerKind.includes('state')) {
    return 'rgba(59, 130, 246, 0.8)'; // blue-500
  }

  // Network/HTTP operations - Cyan
  if (lowerKind.includes('http') || lowerKind.includes('request') || lowerKind.includes('response')) {
    return 'rgba(6, 182, 212, 0.8)'; // cyan-500
  }

  // Database operations - Cyan
  if (lowerKind.includes('database') || lowerKind.includes('query') || lowerKind.includes('db')) {
    return 'rgba(6, 182, 212, 0.8)'; // cyan-500
  }

  // Default - Gray
  return 'rgba(107, 114, 128, 0.8)'; // gray-500
}
