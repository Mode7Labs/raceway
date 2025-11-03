import { cn } from '@/lib/utils';

interface ServiceLinkProps {
  serviceName: string;
  onClick: (serviceName: string) => void;
  className?: string;
  children?: React.ReactNode;
}

export function ServiceLink({ serviceName, onClick, className, children }: ServiceLinkProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(serviceName);
      }}
      className={cn(
        "font-mono text-xs transition-all cursor-pointer no-underline",
        className
      )}
      style={{ textDecoration: 'none' }}
      title={`View ${serviceName} service`}
    >
      {children || serviceName}
    </button>
  );
}
