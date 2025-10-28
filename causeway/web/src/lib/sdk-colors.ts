import { SiTypescript, SiPython, SiGo, SiRust } from 'react-icons/si';
import type { IconType } from 'react-icons';

/**
 * SDK Language Brand Colors and Utilities
 */

export type SDKLanguage = 'typescript' | 'python' | 'go' | 'rust';

export interface SDKColorScheme {
  primary: string;
  bg: string;
  border: string;
  text: string;
  Icon: IconType; // React icon component
}

/**
 * Brand colors for each SDK language
 */
export const SDK_COLORS: Record<SDKLanguage, SDKColorScheme> = {
  typescript: {
    primary: '#3178C6',
    bg: 'bg-[#3178C6]/10',
    border: 'border-[#3178C6]/30',
    text: 'text-[#3178C6]',
    Icon: SiTypescript,
  },
  python: {
    primary: '#3776AB',
    bg: 'bg-[#3776AB]/10',
    border: 'border-[#3776AB]/30',
    text: 'text-[#3776AB]',
    Icon: SiPython,
  },
  go: {
    primary: '#00ADD8',
    bg: 'bg-[#00ADD8]/10',
    border: 'border-[#00ADD8]/30',
    text: 'text-[#00ADD8]',
    Icon: SiGo,
  },
  rust: {
    primary: '#CE422B',
    bg: 'bg-[#CE422B]/10',
    border: 'border-[#CE422B]/30',
    text: 'text-[#CE422B]',
    Icon: SiRust,
  },
};

/**
 * Get SDK language from event metadata tags
 */
export function getSDKLanguage(tags: Record<string, string> | undefined): SDKLanguage | null {
  if (!tags || !tags.sdk_language) return null;
  const lang = tags.sdk_language.toLowerCase();
  if (lang === 'typescript' || lang === 'python' || lang === 'go' || lang === 'rust') {
    return lang as SDKLanguage;
  }
  return null;
}

/**
 * Get SDK color scheme for an event
 */
export function getSDKColorScheme(tags: Record<string, string> | undefined): SDKColorScheme | null {
  const lang = getSDKLanguage(tags);
  return lang ? SDK_COLORS[lang] : null;
}

/**
 * Get SDK display name
 */
export function getSDKDisplayName(lang: SDKLanguage): string {
  const names: Record<SDKLanguage, string> = {
    typescript: 'TypeScript',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
  };
  return names[lang];
}

/**
 * Get Tailwind classes for SDK badge
 */
export function getSDKBadgeClasses(lang: SDKLanguage): string {
  const scheme = SDK_COLORS[lang];
  return `${scheme.bg} ${scheme.border}`;
}

/**
 * Get inline style for SDK text color (for stronger color application)
 */
export function getSDKTextColor(lang: SDKLanguage): { color: string } {
  return { color: SDK_COLORS[lang].primary };
}
