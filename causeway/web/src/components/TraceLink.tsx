import { cn } from '@/lib/utils';

interface TraceLinkProps {
  traceId: string;
  onClick: (traceId: string) => void;
  className?: string;
  children?: React.ReactNode;
  showShortId?: boolean;
}

export function TraceLink({ traceId, onClick, className, children, showShortId = false }: TraceLinkProps) {
  const displayText = children || (showShortId ? `${traceId.slice(0, 8)}...` : traceId);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(traceId);
      }}
      className={cn(
        "font-mono text-xs hover:underline hover:text-primary transition-colors cursor-pointer",
        className
      )}
      title={`View trace ${traceId}`}
    >
      {displayText}
    </button>
  );
}
