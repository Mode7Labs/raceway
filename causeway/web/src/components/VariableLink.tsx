import { cn } from '@/lib/utils';

interface VariableLinkProps {
  variableName: string;
  onClick: (variableName: string) => void;
  className?: string;
  children?: React.ReactNode;
}

export function VariableLink({ variableName, onClick, className, children }: VariableLinkProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(variableName);
      }}
      className={cn(
        "font-mono text-xs hover:underline hover:text-primary transition-colors cursor-pointer",
        className
      )}
      title={`View audit trail for ${variableName}`}
    >
      {children || variableName}
    </button>
  );
}
