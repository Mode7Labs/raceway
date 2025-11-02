import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Event } from '@/types';
import { parseEventKind } from '@/lib/event-utils';

interface EventKindBadgeProps {
  eventKind: Event['kind'];
  className?: string;
  onClick?: () => void;
}

// Get vibrant color scheme for event category
function getEventColorScheme(category: string): string {
  const lower = category.toLowerCase();

  // HTTP Operations - Blue tones
  if (lower.includes('httprequest')) {
    return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  }
  if (lower.includes('httpresponse')) {
    return 'bg-green-500/15 text-green-400 border-green-500/30';
  }

  // State Changes - Amber/Cyan based on access type
  if (lower.includes('statechange:write') || lower.includes('write')) {
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  }
  if (lower.includes('statechange:read') || lower.includes('read')) {
    return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
  }
  if (lower.includes('statechange')) {
    return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
  }

  // Lock Operations - Red/Pink tones
  if (lower.includes('lockacquire') || lower.includes('acquire')) {
    return 'bg-red-500/15 text-red-400 border-red-500/30';
  }
  if (lower.includes('lockrelease') || lower.includes('release')) {
    return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  }

  // Function Calls - Purple tones
  if (lower.includes('functioncall') || lower.includes('function')) {
    return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
  }

  // Thread Operations - Gray tones
  if (lower.includes('spawn') || lower.includes('fork') || lower.includes('thread')) {
    return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
  if (lower.includes('join') || lower.includes('wait')) {
    return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  }

  // Database Operations - Indigo tones
  if (lower.includes('database') || lower.includes('query') || lower.includes('db')) {
    return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
  }

  // Message/Event Operations - Emerald tones
  if (lower.includes('message') || lower.includes('event') || lower.includes('emit')) {
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  }

  // Default - Neutral gray
  return 'bg-gray-500/15 text-gray-400 border-gray-500/30';
}

export function EventKindBadge({ eventKind, className, onClick }: EventKindBadgeProps) {
  const { display, category } = parseEventKind(eventKind);
  const colorScheme = getEventColorScheme(category);

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] border transition-all",
        colorScheme,
        onClick && "cursor-pointer hover:brightness-110 hover:scale-105",
        className
      )}
      onClick={onClick}
    >
      {display}
    </Badge>
  );
}
