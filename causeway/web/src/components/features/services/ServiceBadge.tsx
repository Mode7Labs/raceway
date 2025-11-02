import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getSDKLanguage, SDK_COLORS, type SDKLanguage } from '@/lib/sdk-colors';

interface ServiceBadgeProps {
  serviceName: string;
  tags?: Record<string, string>;
  className?: string;
  showIcon?: boolean;
  onClick?: () => void;
}

export function ServiceBadge({
  serviceName,
  tags,
  className,
  showIcon = true,
  onClick
}: ServiceBadgeProps) {
  const sdkLanguage = getSDKLanguage(tags);
  const SDKIcon = sdkLanguage && showIcon ? SDK_COLORS[sdkLanguage].Icon : null;

  // Get the color scheme for this SDK
  const getColorClasses = (lang: SDKLanguage | null): string => {
    if (!lang) {
      return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
    }

    const scheme = SDK_COLORS[lang];
    return `${scheme.bg} ${scheme.border}`;
  };

  const getTextStyle = (lang: SDKLanguage | null): React.CSSProperties | undefined => {
    if (!lang) return undefined;

    // Python uses gradient background with yellow accent
    if (lang === 'python') {
      return {
        color: '#FFD43B', // Python yellow for text
        fontWeight: 600,
      };
    }

    // Other languages use their primary brand color
    return {
      color: SDK_COLORS[lang].primary,
      fontWeight: 600,
    };
  };

  const getBackgroundStyle = (lang: SDKLanguage | null): React.CSSProperties | undefined => {
    if (!lang) return undefined;

    // Python gets a blue-to-darker-blue gradient with yellow accent
    if (lang === 'python') {
      return {
        background: 'linear-gradient(135deg, rgba(55, 118, 171, 0.15) 0%, rgba(48, 105, 152, 0.1) 100%)',
        borderColor: 'rgba(255, 212, 59, 0.3)',
      };
    }

    return undefined;
  };

  const combinedStyle = {
    ...getBackgroundStyle(sdkLanguage),
    ...getTextStyle(sdkLanguage),
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono flex items-center gap-1 transition-all",
        getColorClasses(sdkLanguage),
        onClick && "cursor-pointer hover:brightness-110 hover:scale-105",
        className
      )}
      style={Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined}
      onClick={onClick}
    >
      {SDKIcon && <SDKIcon className="w-2.5 h-2.5" />}
      {serviceName}
    </Badge>
  );
}
